#!/usr/bin/env node
import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  chmod,
  chown,
  cp,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  rendererRuntimeFingerprint,
  runtimeIdentity,
} from "./runtime-image-identity.mjs";
import { acquireMutationLock } from "./mutation-lock.mjs";
import {
  boundedIntegerEnvironment,
  validPortEnvironment,
} from "./environment.mjs";

const host = process.env.IMAGE_MANAGER_HOST ?? "127.0.0.1";
const port = validPortEnvironment(process.env, "IMAGE_MANAGER_PORT", 3110);
const tokenFile =
  process.env.IMAGE_MANAGER_TOKEN_FILE ??
  "/etc/latex-renderer/secrets/image-manager-token";
const rendererEnv =
  process.env.RENDERER_ENV_FILE ?? "/etc/latex-renderer/renderer.env";
const repoRoot =
  process.env.IMAGE_MANAGER_REPO_ROOT ?? "/opt/latex-renderer/current";
const stateRoot =
  process.env.IMAGE_MANAGER_STATE_ROOT ??
  "/var/lib/latex-renderer/image-manager";
const dockerConfigRoot =
  process.env.DOCKER_CONFIG ?? join(stateRoot, "docker-config");
const environmentRoot =
  process.env.RENDERER_ENVIRONMENT_ROOT ??
  "/var/lib/latex-renderer/environment";
const workerUser = process.env.RENDERER_WORKER_USER ?? "latex-render-worker";
const imageRepository =
  process.env.TEXLIVE_IMAGE_REPOSITORY ??
  "ghcr.io/n624-dev/latex-renderer-texlive";
const fetchTimeoutMs = boundedIntegerEnvironment(
  process.env,
  "IMAGE_MANAGER_FETCH_TIMEOUT_MS",
  30_000,
  1_000,
  120_000,
);
const maxOperationLogBytes = boundedIntegerEnvironment(
  process.env,
  "IMAGE_MANAGER_MAX_OPERATION_LOG_BYTES",
  4 * 1024 * 1024,
  64 * 1024,
  64 * 1024 * 1024,
);
const ghcrPath = imageRepository.replace(/^ghcr\.io\//, "");
const [ghcrOwner, ...ghcrNameParts] = ghcrPath.split("/");
const ghcrName = ghcrNameParts.join("/");
if (!["127.0.0.1", "::1"].includes(host))
  throw new Error("IMAGE_MANAGER_HOST must be a loopback address");
if (!ghcrOwner || !ghcrName)
  throw new Error("TEXLIVE_IMAGE_REPOSITORY must point to ghcr.io/owner/name");

await mkdir(stateRoot, { recursive: true, mode: 0o750 });
await mkdir(environmentRoot, { recursive: true, mode: 0o750 });
const token = (await readFile(tokenFile, "utf8")).trim();
if (token.length < 32) throw new Error("Image manager token is too short");
const workerUid = Number((await runCapture("id", ["-u", workerUser])).trim());
if (!Number.isInteger(workerUid) || workerUid < 1)
  throw new Error("Could not resolve renderer worker uid");
const workerGid = Number((await runCapture("id", ["-g", workerUser])).trim());
if (!Number.isInteger(workerGid) || workerGid < 1)
  throw new Error("Could not resolve renderer worker gid");
await mkdir(dockerConfigRoot, { recursive: true, mode: 0o700 });
await chown(dockerConfigRoot, workerUid, workerGid);
await chmod(dockerConfigRoot, 0o700);
const workerPasswd = (await runCapture("getent", ["passwd", workerUser]))
  .trim()
  .split(":");
const workerHome = workerPasswd[5];
if (!workerHome?.startsWith("/"))
  throw new Error("Could not resolve renderer worker home");
const runtimeDir = `/run/user/${workerUid}`;
const dockerHost = `unix://${runtimeDir}/docker.sock`;
const statePath = join(stateRoot, "state.json");
const operationsRoot = join(stateRoot, "operations");
const activationJournalPath = join(stateRoot, "activation-journal.json");
const legacyMigrationMarker = join(stateRoot, "migrate-legacy-languages");
await mkdir(operationsRoot, { recursive: true, mode: 0o750 });

const emptyState = () => ({
  version: 1,
  desired: {
    selector: { mode: "latest", value: null },
    languages: [],
    autoUpdate: false,
    countryOverride: null,
  },
  current: null,
  previous: null,
  lastOperationId: null,
  lastApplyError: null,
  updatedAt: new Date().toISOString(),
});

let state = await loadState();
const operations = new Map();
let activeOperationId = null;
let languageCache = null;
let quiescing = false;
let mutationGate = Promise.resolve();
const activationRecovery = await recoverPendingActivation();
await recoverInterruptedOperation(activationRecovery);
await seedCurrentRuntimeIfNeeded();

async function loadState() {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    const desired = { ...emptyState().desired, ...(parsed.desired ?? {}) };
    // v1.2.x could require a separately published derived Runtime and stored
    // this opt-in fallback.  Derived Runtimes are now always local, so do not
    // expose or persist the obsolete setting after loading old state.
    delete desired.runtimeBuildIfMissing;
    return {
      ...emptyState(),
      ...parsed,
      desired,
    };
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const initial = emptyState();
    await persistState(initial);
    return initial;
  }
}

function cloneState(value = state) {
  return JSON.parse(JSON.stringify(value));
}

async function persistState(value = state) {
  value.updatedAt = new Date().toISOString();
  await writeAtomic(statePath, `${JSON.stringify(value, null, 2)}\n`, 0o640);
}

async function writeAtomic(path, content, mode = 0o640) {
  const tmp = `${path}.part-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmp, content, { mode });
    await chmod(tmp, mode);
    await rename(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

async function serializeMutation(task) {
  const previous = mutationGate;
  let release;
  mutationGate = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
}

function safeToken(received) {
  const a = Buffer.from(received ?? "");
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

function rootlessEnv(extra = {}) {
  return {
    ...process.env,
    HOME: workerHome,
    XDG_RUNTIME_DIR: runtimeDir,
    DOCKER_HOST: dockerHost,
    DOCKER_CONFIG: dockerConfigRoot,
    ...extra,
  };
}

function fetchWithTimeout(url, init = {}) {
  return globalThis.fetch(url, {
    ...init,
    signal: init.signal ?? globalThis.AbortSignal.timeout(fetchTimeoutMs),
  });
}

function runCapture(command, args, options = {}) {
  const { maxOutputBytes = 32 * 1024 * 1024, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let capturedBytes = 0;
    let captureError = null;
    const capture = (target, chunk) => {
      if (captureError) return target;
      capturedBytes += chunk.length;
      if (capturedBytes > maxOutputBytes) {
        captureError = new Error(
          `${command} output exceeds the configured capture limit`,
        );
        child.kill("SIGKILL");
        return target;
      }
      return target + String(chunk);
    };
    child.stdout.on("data", (chunk) => {
      stdout = capture(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = capture(stderr, chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (captureError) return reject(captureError);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
    });
  });
}

async function runLogged(op, command, args, options = {}) {
  await appendLog(op, `$ ${command} ${args.join(" ")}\n`);
  const child = spawn(command, args, {
    ...options,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const consume = async (stream) => {
    for await (const chunk of stream) await appendLog(op, String(chunk));
  };
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  try {
    const [code] = await Promise.all([
      closed,
      consume(child.stdout),
      consume(child.stderr),
    ]);
    if (code !== 0) throw new Error(`${command} exited with code ${code}`);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
}

function dockerRunuserArgs(args) {
  return [
    "-u",
    workerUser,
    "--",
    "env",
    `HOME=${workerHome}`,
    `XDG_RUNTIME_DIR=${runtimeDir}`,
    `DOCKER_HOST=${dockerHost}`,
    "docker",
    ...args,
  ];
}

async function dockerCapture(args) {
  return runCapture("runuser", dockerRunuserArgs(args));
}

async function dockerLogged(op, args) {
  return runLogged(op, "runuser", dockerRunuserArgs(args));
}

function redactLog(text) {
  return String(text)
    .replace(
      /((?:authorization|password|secret|token|credential)[=:][ \t]*)[^\s]+/gi,
      "$1[REDACTED]",
    )
    .replace(/\b(?:gh[oprsu]_|github_pat_)[A-Za-z0-9_]+\b/g, "[REDACTED]");
}

function appendLog(op, text) {
  const write = (op.logWrite ?? Promise.resolve()).then(async () => {
    const marker = Buffer.from("\n[LOG_LIMIT_REACHED]\n");
    const bytes = Buffer.from(redactLog(text));
    const handle = await open(op.logPath, "a+", 0o640);
    try {
      const current = (await handle.stat()).size;
      if (current >= maxOperationLogBytes) return;
      const remaining = maxOperationLogBytes - current;
      if (bytes.length <= remaining) {
        await handle.write(bytes);
        return;
      }
      const prefixLength = Math.max(0, remaining - marker.length);
      if (prefixLength > 0) await handle.write(bytes.subarray(0, prefixLength));
      await handle.write(marker.subarray(0, remaining - prefixLength));
    } finally {
      await handle.close();
    }
  });
  op.logWrite = write.catch(() => {});
  return write;
}

function operationView(op) {
  return {
    id: op.id,
    type: op.type,
    status: op.status,
    startedAt: op.startedAt,
    finishedAt: op.finishedAt ?? null,
    error: op.error ?? null,
  };
}

function operationMetaPath(id) {
  return join(operationsRoot, `${id}.json`);
}

async function saveOperation(op) {
  await writeAtomic(
    operationMetaPath(op.id),
    `${JSON.stringify(operationView(op), null, 2)}\n`,
    0o640,
  );
}

async function loadOperation(id) {
  const live = operations.get(id);
  if (live) return live;
  try {
    const saved = JSON.parse(await readFile(operationMetaPath(id), "utf8"));
    return { ...saved, logPath: join(operationsRoot, `${id}.log`) };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function readLogTail(path, maxBytes = 100_000) {
  try {
    const info = await stat(path);
    if (info.size === 0) return "";
    const length = Math.min(info.size, maxBytes);
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        length,
        Math.max(0, info.size - length),
      );
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function operationWithLog(op) {
  return { ...operationView(op), log: await readLogTail(op.logPath) };
}

function rendererImageFromEnv(contents) {
  return /^RENDERER_IMAGE=(.+)$/m.exec(contents)?.[1]?.trim() ?? "";
}

async function recoverPendingActivation() {
  let journal;
  try {
    journal = JSON.parse(await readFile(activationJournalPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (
    journal?.version !== 1 ||
    typeof journal?.newImageId !== "string" ||
    !journal.previousState ||
    !journal.nextState ||
    typeof journal.oldEnv !== "string"
  )
    throw new Error("Image activation journal is invalid");

  const configured = rendererImageFromEnv(await readFile(rendererEnv, "utf8"));
  const oldImage = rendererImageFromEnv(journal.oldEnv);
  if (configured === journal.newImageId) {
    await dockerCapture(["image", "inspect", journal.newImageId]);
    await writeInventory(await collectInventory(journal.newImageId));
    state = journal.nextState;
    await persistState();
    await rm(activationJournalPath, { force: true });
    return { operationId: journal.operationId ?? null, committed: true };
  }
  if (configured === oldImage) {
    state = journal.previousState;
    await persistState();
    if (oldImage) {
      await dockerCapture(["image", "inspect", oldImage]);
      await writeInventory(await collectInventory(oldImage));
    }
    await rm(activationJournalPath, { force: true });
    return { operationId: journal.operationId ?? null, committed: false };
  }
  throw new Error(
    `Image activation recovery refused an unexpected RENDERER_IMAGE: ${configured || "missing"}`,
  );
}

async function recoverInterruptedOperation(activationOutcome = null) {
  if (!state.lastOperationId) return;
  const op = await loadOperation(state.lastOperationId);
  if (!op || op.status !== "running") return;
  const recoveredCommit =
    activationOutcome?.operationId === op.id &&
    activationOutcome.committed === true;
  op.status = recoveredCommit ? "succeeded" : "failed";
  op.error = recoveredCommit
    ? null
    : "Image manager restarted while this operation was running";
  op.finishedAt = new Date().toISOString();
  await saveOperation(op);
  state.lastApplyError = op.error;
  await persistState();
  await appendLog(
    op,
    recoveredCommit
      ? "\nImage activation was recovered and committed after Image Manager restart.\n"
      : "\nERROR: Image Manager restarted before this operation completed.\n",
  ).catch(() => {});
}

async function finishOperationSucceeded(op) {
  await serializeMutation(async () => {
    op.status = "succeeded";
    op.finishedAt = new Date().toISOString();
    state.lastApplyError = null;
    await saveOperation(op).catch(async (error) => {
      await appendLog(
        op,
        `\nWARNING: operation completed, but completion metadata could not be saved: ${error instanceof Error ? error.message : String(error)}\n`,
      ).catch(() => {});
    });
    await persistState().catch(async (error) => {
      await appendLog(
        op,
        `\nWARNING: operation completed, but housekeeping state could not be saved: ${error instanceof Error ? error.message : String(error)}\n`,
      ).catch(() => {});
    });
    activeOperationId = null;
  });
}

async function finishOperationFailed(op, error) {
  await serializeMutation(async () => {
    op.status = "failed";
    op.error = error instanceof Error ? error.message : String(error);
    op.finishedAt = new Date().toISOString();
    state.lastApplyError = op.error;
    await appendLog(op, `\nERROR: ${op.error}\n`).catch(() => {});
    await saveOperation(op).catch(() => {});
    await persistState().catch(() => {});
    activeOperationId = null;
  });
}

async function startOperation(type, task) {
  return serializeMutation(async () => {
    if (quiescing) {
      throw httpError(
        503,
        "IMAGE_MANAGER_QUIESCING",
        "Image Manager is quiescing for deployment",
      );
    }
    if (activeOperationId) {
      throw httpError(
        409,
        "IMAGE_OPERATION_ACTIVE",
        "Another image operation is already running",
      );
    }
    let mutationLock;
    try {
      mutationLock = await acquireMutationLock();
    } catch (error) {
      if (error?.code === "MUTATION_LOCK_BUSY") {
        throw httpError(409, "MUTATION_LOCK_BUSY", error.message);
      }
      throw error;
    }
    const id = `imgop_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const op = {
      id,
      type,
      status: "running",
      startedAt: new Date().toISOString(),
      logPath: join(operationsRoot, `${id}.log`),
    };
    const previousLastOperationId = state.lastOperationId;
    operations.set(id, op);
    activeOperationId = id;
    state.lastOperationId = id;
    try {
      await saveOperation(op);
      await persistState();
    } catch (error) {
      operations.delete(id);
      activeOperationId = null;
      state.lastOperationId = previousLastOperationId;
      await rm(operationMetaPath(id), { force: true }).catch(() => {});
      await persistState().catch(() => {});
      await mutationLock.release().catch(() => {});
      throw error;
    }

    void Promise.resolve()
      .then(() => task(op))
      .then(() => finishOperationSucceeded(op))
      .catch((error) => finishOperationFailed(op, error))
      .finally(async () => {
        operations.delete(id);
        await mutationLock.release().catch(() => {});
      });
    return operationView(op);
  });
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function validateLanguages(value) {
  if (!Array.isArray(value))
    throw httpError(400, "INVALID_LANGUAGES", "languages must be an array");
  const unique = [...new Set(value.map(String))];
  for (const language of unique) {
    if (!/^collection-lang[A-Za-z0-9._-]+$/.test(language)) {
      throw httpError(
        400,
        "INVALID_LANGUAGE",
        `Invalid language collection: ${language}`,
      );
    }
  }
  return unique.sort();
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validIsoWeek(value) {
  const match = /^(\d{4})-W(\d{2})$/.exec(value ?? "");
  if (!match) return false;
  const week = Number(match[2]);
  return week >= 1 && week <= 53;
}

function validateSelector(value) {
  if (!value || typeof value !== "object")
    throw httpError(400, "INVALID_SELECTOR", "selector is required");
  const mode = value.mode;
  const raw = value.value == null ? null : String(value.value);
  if (mode === "latest") return { mode, value: null };
  if (mode === "date" && validDate(raw)) return { mode, value: raw };
  if (mode === "weekly" && validIsoWeek(raw)) return { mode, value: raw };
  if (mode === "digest" && /^sha256:[a-f0-9]{64}$/.test(raw ?? ""))
    return { mode, value: raw };
  throw httpError(400, "INVALID_SELECTOR", "Invalid image selector");
}

function selectorReference(selector) {
  if (selector.mode === "latest") return `${imageRepository}:latest`;
  if (selector.mode === "date") return `${imageRepository}:${selector.value}`;
  if (selector.mode === "weekly")
    return `${imageRepository}:weekly-${selector.value}`;
  return `${imageRepository}@${selector.value}`;
}

function snapshotDateFromRepository(repository) {
  const match = /tlnet-archive\/(\d{4})\/(\d{2})\/(\d{2})\/tlnet/.exec(
    repository ?? "",
  );
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

async function resolveSnapshot(requested, op) {
  const output = await runCapture(
    "sh",
    [join(repoRoot, "deploy/scripts/resolve-texlive-snapshot.sh"), requested],
    { env: process.env },
  );
  if (op) await appendLog(op, output);
  return Object.fromEntries(
    output
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split(/=(.*)/s).slice(0, 2)),
  );
}

async function pullOrRebuildBase(op, selector, rebuildIfMissing) {
  const ref = selectorReference(selector);
  try {
    await dockerLogged(op, ["pull", ref]);
    return inspectBase(ref);
  } catch (pullError) {
    if (!(selector.mode === "date" && rebuildIfMissing)) {
      try {
        await listImages();
      } catch (registryError) {
        await appendLog(
          op,
          `GHCR access check failed after pull error: ${registryError instanceof Error ? registryError.message : String(registryError)}\n`,
        );
        throw registryError;
      }
      throw pullError;
    }
    let images;
    try {
      images = await listImages();
    } catch (discoveryError) {
      await appendLog(
        op,
        `Registry discovery failed after pull error; refusing local rebuild: ${discoveryError instanceof Error ? discoveryError.message : String(discoveryError)}\n`,
      );
      throw discoveryError;
    }
    if (images.daily.includes(selector.value)) {
      await appendLog(
        op,
        `Registry still reports ${selector.value}; refusing local rebuild because the pull failure was not proven to be a missing tag.\n`,
      );
      throw pullError;
    }
    await appendLog(
      op,
      `GHCR confirms ${selector.value} is absent; rebuilding locally from the dated TeX Live archive.\n`,
    );
    return rebuildDatedBase(op, selector.value);
  }
}

async function inspectBase(ref) {
  const raw = await dockerCapture([
    "image",
    "inspect",
    ref,
    "--format",
    "{{json .}}",
  ]);
  const info = JSON.parse(raw);
  const labels = info.Config?.Labels ?? {};
  const repository = labels["jp.n624.latex-renderer.texlive.repository"];
  const profileKind = labels["jp.n624.latex-renderer.texlive.profile-kind"];
  const baseKind = labels["jp.n624.latex-renderer.base-kind"];
  if (
    labels["org.opencontainers.image.title"] !== "latex-renderer-texlive" ||
    !repository ||
    profileKind !== "language-neutral-maximal" ||
    baseKind !== "texlive-only-v1"
  ) {
    throw new Error(
      "Selected image is not a validated renderer-free language-neutral latex-renderer TeX Live base",
    );
  }
  const matchingDigest = Array.isArray(info.RepoDigests)
    ? info.RepoDigests.find((item) => item.startsWith(`${imageRepository}@`))
    : undefined;
  const digest = matchingDigest?.split("@")[1] ?? info.Id;
  // A tag is only a discovery selector. Carry the registry's
  // digest-qualified reference into every subsequent build so a later tag
  // mutation cannot change the Base used by the derived Runtime. Locally
  // built Bases have no RepoDigest and are addressed by their image ID.
  return {
    ref: matchingDigest ?? info.Id,
    imageId: info.Id,
    digest,
    repository,
    snapshotDate: snapshotDateFromRepository(repository),
  };
}

async function rebuildDatedBase(op, date) {
  const snapshot = await resolveSnapshot(date, op);
  const work = await mkdtemp(join(stateRoot, `base-${date}-`));
  const context = join(work, "renderer");
  try {
    await cp(join(repoRoot, "renderer"), context, { recursive: true });
    await runLogged(op, "sh", [
      join(repoRoot, "deploy/scripts/generate-texlive-profile.sh"),
      snapshot.repository,
      join(context, "texlive.profile"),
    ]);
    await runLogged(op, "chmod", ["-R", "a+rX", work]);
    const tag = `latex-renderer:base-${date}-local`;
    await dockerLogged(op, [
      "build",
      "--no-cache",
      "--pull",
      "--file",
      join(context, "Dockerfile.base"),
      "--build-arg",
      `TEXLIVE_REPOSITORY=${snapshot.repository}`,
      "--build-arg",
      `TEXLIVE_INSTALLER_SHA512=${snapshot.installer_sha512}`,
      "--build-arg",
      "TEXLIVE_PROFILE_KIND=language-neutral-maximal",
      "--tag",
      tag,
      context,
    ]);
    return inspectBase(tag);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function installedLanguageCollections(ref) {
  const installed = await dockerCapture([
    "run",
    "--rm",
    "--entrypoint",
    "/bin/sh",
    ref,
    "-c",
    "tlmgr info --only-installed --data name 2>/dev/null | sed 's/^name: //' | grep '^collection-lang' || true",
  ]);
  return installed.split(/\r?\n/).filter(Boolean).sort();
}

async function legacyLanguageMigrationRequested() {
  try {
    await readFile(legacyMigrationMarker, "utf8");
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function seedCurrentRuntimeIfNeeded() {
  if (state.current) return;
  let configured;
  try {
    configured = rendererImageFromEnv(await readFile(rendererEnv, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return;
  }
  if (!configured) return;

  try {
    const raw = await dockerCapture([
      "image",
      "inspect",
      configured,
      "--format",
      "{{json .}}",
    ]);
    const info = JSON.parse(raw);
    const labels = info.Config?.Labels ?? {};
    const repository =
      labels["jp.n624.latex-renderer.texlive.repository"] ?? null;
    const snapshotDate = snapshotDateFromRepository(repository);
    const languages = await installedLanguageCollections(info.Id);
    const migrateLanguages = await legacyLanguageMigrationRequested();
    state.current = {
      selector: snapshotDate ? { mode: "date", value: snapshotDate } : null,
      baseRef: null,
      baseDigest: null,
      baseImageId: null,
      runtimeRef: configured,
      runtimeImageId: info.Id,
      snapshotDate,
      languages,
      effectiveLanguageCollections: languages,
      appliedAt: null,
      legacy: true,
    };
    if (migrateLanguages && (state.desired.languages?.length ?? 0) === 0) {
      state.desired.languages = [...languages];
    }
    await persistState();
    if (migrateLanguages) await rm(legacyMigrationMarker, { force: true });
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "image_manager.seed_skipped",
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

async function buildRuntime(op, base, languages) {
  const rendererFingerprint = await rendererRuntimeFingerprint(
    join(repoRoot, "renderer"),
  );
  const identity = runtimeIdentity({
    baseImageId: base.imageId,
    rendererFingerprint,
    languages,
    snapshotDate: base.snapshotDate,
  });
  const tag = `latex-renderer:${identity.tag}`;
  await runLogged(
    op,
    "sh",
    [
      join(repoRoot, "deploy/scripts/build-language-runtime.sh"),
      base.ref,
      base.repository,
      tag,
      ...languages,
    ],
    { env: rootlessEnv() },
  );
  const imageId = (
    await dockerCapture(["image", "inspect", tag, "--format", "{{.Id}}"])
  ).trim();
  const installed = await installedLanguageCollections(tag);
  const missing = languages.filter((language) => !installed.includes(language));
  if (missing.length > 0) {
    throw new Error(
      `Selected language collections were not installed: ${missing.join(",")}`,
    );
  }
  const builtRendererFingerprint = (
    await dockerCapture([
      "image",
      "inspect",
      tag,
      "--format",
      '{{index .Config.Labels "jp.n624.latex-renderer.renderer-runtime-fingerprint"}}',
    ])
  ).trim();
  if (builtRendererFingerprint !== rendererFingerprint) {
    throw new Error(
      "Derived runtime is missing the current renderer runtime fingerprint",
    );
  }
  return {
    ref: tag,
    imageId,
    rendererFingerprint,
    effectiveLanguages: installed,
    identity: identity.digest,
    source: "local-build",
    packageRef: null,
  };
}

async function inspectRuntimeCandidate(ref, expected) {
  const raw = await dockerCapture([
    "image",
    "inspect",
    ref,
    "--format",
    "{{json .}}",
  ]);
  const info = JSON.parse(raw);
  const labels = info.Config?.Labels ?? {};
  const languages = validateLanguages(
    String(labels["jp.n624.latex-renderer.languages"] ?? "")
      .split(",")
      .filter(Boolean),
  );
  if (
    labels["jp.n624.latex-renderer.runtime-kind"] !== "managed-local-v1" ||
    labels["jp.n624.latex-renderer.runtime-identity"] !== expected.digest ||
    labels["jp.n624.latex-renderer.base-image-id"] !== expected.baseImageId ||
    labels["jp.n624.latex-renderer.renderer-runtime-fingerprint"] !==
      expected.rendererFingerprint ||
    !sameLanguages(languages, expected.languages)
  ) {
    throw new Error(
      `Runtime image identity metadata does not match the requested environment: ${ref}`,
    );
  }
  const installed = await installedLanguageCollections(ref);
  const missing = expected.languages.filter(
    (language) => !installed.includes(language),
  );
  if (missing.length > 0) {
    throw new Error(
      `Local Runtime is missing selected language collections: ${missing.join(",")}`,
    );
  }
  return {
    ref: info.Id,
    imageId: info.Id,
    rendererFingerprint: expected.rendererFingerprint,
    effectiveLanguages: installed,
    identity: expected.digest,
    source: "local-build",
    packageRef: null,
  };
}

async function acquireRuntime(op, base, languages) {
  const expected = runtimeIdentity({
    baseImageId: base.imageId,
    rendererFingerprint: await rendererRuntimeFingerprint(
      join(repoRoot, "renderer"),
    ),
    languages,
    snapshotDate: base.snapshotDate,
  });
  const localRef = `latex-renderer:${expected.tag}`;
  try {
    const runtime = await inspectRuntimeCandidate(localRef, expected);
    await appendLog(
      op,
      `Reusing the verified local TeX Runtime for ${base.snapshotDate ?? "the selected Base"} with ${expected.languages.length} optional language collection(s).\n`,
    );
    return runtime;
  } catch {
    // A missing or stale local cache entry is not authoritative. Rebuild the
    // derived Runtime from the already verified, immutable Base below.
  }
  await appendLog(
    op,
    `Building a local TeX Runtime from the verified ${base.snapshotDate ?? "selected"} Base with ${expected.languages.length} optional language collection(s).\n`,
  );
  return buildRuntime(op, base, languages);
}

async function validateRuntime(op, runtimeRef) {
  await runLogged(
    op,
    "sh",
    [join(repoRoot, "deploy/scripts/smoke-test-renderer-basic.sh"), runtimeRef],
    { env: rootlessEnv() },
  );
}

async function collectInventory(runtimeRef) {
  const packages = await dockerCapture([
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--entrypoint",
    "/bin/sh",
    runtimeRef,
    "-c",
    "{ tlmgr info --only-installed --data name 2>/dev/null | sed 's/^name: //' | sed '/^$/d'; find /opt/texlive/2026/texmf-dist/tex -type f \\( -name '*.sty' -o -name '*.cls' -o -name '*.tex' -o -name '*.lua' -o -name '*.bst' \\) -printf '%f\\n' | sed 's/\\.[^.]*$//'; } | LC_ALL=C sort -fu",
  ]);
  const fonts = await dockerCapture([
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--entrypoint",
    "/bin/sh",
    runtimeRef,
    "-c",
    "{ fc-list --format '%{family}\\n'; find /opt/texlive/2026/texmf-dist/fonts -type f \\( -name '*.otf' -o -name '*.ttf' \\) -print0 | xargs -0 -r fc-scan --format '%{family}\\n'; } | tr ',' '\\n' | sed '/^[[:space:]]*$/d' | LC_ALL=C sort -fu",
  ]);
  if (!packages.trim() || !fonts.trim())
    throw new Error("Renderer environment inventory generation failed");
  return { packages, fonts };
}

async function readInventorySnapshot() {
  const result = {};
  for (const name of ["packages", "fonts"]) {
    try {
      result[name] = await readFile(
        join(environmentRoot, `${name}.txt`),
        "utf8",
      );
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      result[name] = null;
    }
  }
  return result;
}

async function writeInventory(inventory) {
  await writeAtomic(
    join(environmentRoot, "packages.txt"),
    inventory.packages,
    0o640,
  );
  await writeAtomic(join(environmentRoot, "fonts.txt"), inventory.fonts, 0o640);
}

async function restoreInventory(snapshot) {
  for (const name of ["packages", "fonts"]) {
    const path = join(environmentRoot, `${name}.txt`);
    if (snapshot[name] === null) await rm(path, { force: true });
    else await writeAtomic(path, snapshot[name], 0o640);
  }
}

function rendererEnvWithImage(contents, imageId) {
  const line = `RENDERER_IMAGE=${imageId}`;
  return /^RENDERER_IMAGE=.*$/m.test(contents)
    ? contents.replace(/^RENDERER_IMAGE=.*$/m, line)
    : `${contents.replace(/\s*$/, "")}\n${line}\n`;
}

async function restartRendererConsumers() {
  await runCapture("systemctl", ["restart", "latex-renderer-worker.service"]);
  await runCapture("systemctl", [
    "try-restart",
    "latex-renderer-internal-api.service",
    "latex-renderer-admin-api.service",
    "latex-renderer-remote-mcp.service",
  ]);
}

async function restoreActivation(snapshot) {
  const failures = [];
  let envRestored = true;
  try {
    await writeAtomic(rendererEnv, snapshot.oldEnv, 0o640);
  } catch (error) {
    envRestored = false;
    failures.push(
      `renderer.env: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (snapshot.envChanged && envRestored) {
    try {
      await restartRendererConsumers();
    } catch (error) {
      failures.push(
        `service restart: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  try {
    await restoreInventory(snapshot.oldInventory);
  } catch (error) {
    failures.push(
      `inventory: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
}

async function activateAndPersistState(
  op,
  previousState,
  nextState,
  imageId,
  inventory,
  context,
) {
  await dockerCapture(["image", "inspect", imageId]);
  const oldEnv = await readFile(rendererEnv, "utf8");
  const oldInventory = await readInventorySnapshot();
  const newEnv = rendererEnvWithImage(oldEnv, imageId);
  const snapshot = { oldEnv, oldInventory, envChanged: newEnv !== oldEnv };
  const journal = {
    version: 1,
    operationId: op.id,
    context,
    oldEnv,
    newImageId: imageId,
    previousState,
    nextState,
    preparedAt: new Date().toISOString(),
  };
  await writeAtomic(
    activationJournalPath,
    `${JSON.stringify(journal, null, 2)}\n`,
    0o640,
  );

  try {
    if (newEnv !== oldEnv) {
      await writeAtomic(rendererEnv, newEnv, 0o640);
      await restartRendererConsumers();
    }
    await writeInventory(inventory);
    state = nextState;
    await persistState();
    await rm(activationJournalPath, { force: true });
  } catch (error) {
    state = previousState;
    let restoreError;
    try {
      await restoreActivation(snapshot);
    } catch (inner) {
      restoreError = inner;
    }
    await persistState(previousState).catch(() => {});
    if (restoreError === undefined)
      await rm(activationJournalPath, { force: true }).catch(() => {});
    if (restoreError !== undefined) {
      const restoreMessage =
        restoreError instanceof Error
          ? restoreError.message
          : String(restoreError);
      await appendLog(
        op,
        `${context} failed; previous Runtime restoration was incomplete: ${restoreMessage}\n`,
      ).catch(() => {});
      throw new Error(
        `${context} failed and previous Runtime restoration was incomplete: ${restoreMessage}; original error: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
    await appendLog(
      op,
      `${context} failed; previous Runtime was restored\n`,
    ).catch(() => {});
    throw new Error(
      `${context} failed and the previous Runtime was restored: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

async function applyRuntime(op, input, resolvedBase = null) {
  const selector = validateSelector(input.selector);
  const languages = validateLanguages(input.languages ?? []);
  const autoUpdate = Boolean(input.autoUpdate);
  const rebuildIfMissing = input.rebuildIfMissing !== false;
  await appendLog(
    op,
    `Applying ${JSON.stringify({ selector, languages, autoUpdate })}\n`,
  );
  const base =
    resolvedBase ?? (await pullOrRebuildBase(op, selector, rebuildIfMissing));
  const runtime = await acquireRuntime(op, base, languages);
  await validateRuntime(op, runtime.ref);
  const inventory = await collectInventory(runtime.ref);
  const previousState = cloneState();
  const nextState = {
    ...previousState,
    previous: previousState.current,
    desired: {
      ...previousState.desired,
      selector,
      languages,
      autoUpdate,
    },
    current: {
      selector,
      baseRef: base.ref,
      baseDigest: base.digest,
      baseImageId: base.imageId,
      runtimeRef: runtime.ref,
      runtimeImageId: runtime.imageId,
      rendererRuntimeFingerprint: runtime.rendererFingerprint,
      runtimeIdentity: runtime.identity,
      runtimeSource: runtime.source,
      runtimePackageRef: runtime.packageRef,
      snapshotDate: base.snapshotDate,
      languages,
      effectiveLanguageCollections: runtime.effectiveLanguages,
      appliedAt: new Date().toISOString(),
      legacy: false,
    },
  };
  await activateAndPersistState(
    op,
    previousState,
    nextState,
    runtime.imageId,
    inventory,
    "Runtime apply",
  );
}

async function rollback(op) {
  const target = state.previous;
  if (!target?.runtimeImageId)
    throw new Error("No previous known-good runtime is available");
  const previousState = cloneState();
  const current = previousState.current;
  let nextCurrent;
  let imageId;
  let inventory;

  if (target.legacy === true || !target.baseImageId) {
    await dockerLogged(op, ["image", "inspect", target.runtimeImageId]);
    await validateRuntime(op, target.runtimeImageId);
    imageId = target.runtimeImageId;
    inventory = await collectInventory(target.runtimeImageId);
    nextCurrent = cloneState(target);
  } else {
    const base = await inspectBase(target.baseImageId);
    const languages = validateLanguages(target.languages ?? []);
    const runtime = await acquireRuntime(op, base, languages);
    await validateRuntime(op, runtime.ref);
    imageId = runtime.imageId;
    inventory = await collectInventory(runtime.ref);
    nextCurrent = {
      ...cloneState(target),
      baseRef: target.baseRef ?? base.ref,
      baseDigest: target.baseDigest ?? base.digest,
      baseImageId: base.imageId,
      runtimeRef: runtime.ref,
      runtimeImageId: runtime.imageId,
      rendererRuntimeFingerprint: runtime.rendererFingerprint,
      runtimeIdentity: runtime.identity,
      runtimeSource: runtime.source,
      runtimePackageRef: runtime.packageRef,
      snapshotDate: target.snapshotDate ?? base.snapshotDate,
      languages,
      effectiveLanguageCollections: runtime.effectiveLanguages,
      rendererUpdatedAt: new Date().toISOString(),
      legacy: false,
    };
  }

  const nextState = {
    ...previousState,
    current: nextCurrent,
    previous: current,
    desired: {
      ...previousState.desired,
      ...(nextCurrent.selector ? { selector: nextCurrent.selector } : {}),
      languages: nextCurrent.languages ?? [],
      autoUpdate: false,
    },
  };
  await activateAndPersistState(
    op,
    previousState,
    nextState,
    imageId,
    inventory,
    "Runtime rollback",
  );
}

async function revalidate(op) {
  if (!state.current?.runtimeImageId)
    throw new Error("No managed runtime is active");
  await validateRuntime(op, state.current.runtimeImageId);
  await writeInventory(await collectInventory(state.current.runtimeImageId));
}

async function cleanup(op) {
  const protectedIds = new Set(
    [
      state.current?.runtimeImageId,
      state.current?.baseImageId,
      state.previous?.runtimeImageId,
      state.previous?.baseImageId,
    ].filter(Boolean),
  );
  const ids = [
    ...new Set(
      (await dockerCapture(["image", "ls", "--all", "--no-trunc", "--quiet"]))
        .split(/\r?\n/)
        .filter(Boolean),
    ),
  ];
  let removed = 0;
  for (const id of ids) {
    if (protectedIds.has(id)) continue;
    let info;
    try {
      info = JSON.parse(
        await dockerCapture(["image", "inspect", id, "--format", "{{json .}}"]),
      );
    } catch (error) {
      await appendLog(
        op,
        `cleanup warning: could not inspect ${id}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      continue;
    }
    const labels = info.Config?.Labels ?? {};
    const managedRuntime = Boolean(
      labels["jp.n624.latex-renderer.base-image-id"] &&
      labels["jp.n624.latex-renderer.renderer-runtime-fingerprint"],
    );
    const managedBase =
      labels["org.opencontainers.image.title"] === "latex-renderer-texlive" &&
      labels["jp.n624.latex-renderer.texlive.profile-kind"] ===
        "language-neutral-maximal" &&
      labels["jp.n624.latex-renderer.base-kind"] === "texlive-only-v1";
    if (!managedRuntime && !managedBase) continue;
    await dockerLogged(op, ["image", "rm", "--force", id])
      .then(() => {
        removed += 1;
      })
      .catch(async (error) => {
        await appendLog(
          op,
          `cleanup warning: ${error instanceof Error ? error.message : String(error)}\n`,
        );
      });
  }
  await dockerLogged(op, [
    "builder",
    "prune",
    "--force",
    "--filter",
    "until=168h",
  ]).catch(async (error) => {
    await appendLog(
      op,
      `builder cache cleanup warning: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  });
  await appendLog(
    op,
    `Removed ${removed} unused managed image(s); protected ${protectedIds.size} current/rollback image ID(s). Build cache older than 7 days was pruned when possible.\n`,
  );
}

function sameLanguages(a, b) {
  const left = validateLanguages(a ?? []);
  const right = validateLanguages(b ?? []);
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function sameSelector(a, b) {
  return a?.mode === b?.mode && (a?.value ?? null) === (b?.value ?? null);
}

async function reconcileDesired(op) {
  const selector = validateSelector(state.desired.selector);
  const languages = validateLanguages(state.desired.languages ?? []);
  const autoUpdate = Boolean(state.desired.autoUpdate);
  const currentMatches =
    state.current?.legacy !== true &&
    sameSelector(selector, state.current?.selector) &&
    sameLanguages(languages, state.current?.languages) &&
    state.current?.rendererRuntimeFingerprint ===
      (await rendererRuntimeFingerprint(join(repoRoot, "renderer")));

  if (selector.mode === "latest") {
    const latest = await pullOrRebuildBase(op, selector, false);
    if (currentMatches && state.current?.baseImageId === latest.imageId) {
      await appendLog(op, "Desired latest TeX Runtime is already active.\n");
      return;
    }
    await applyRuntime(
      op,
      {
        selector,
        languages,
        autoUpdate,
        rebuildIfMissing: false,
      },
      latest,
    );
    return;
  }

  if (currentMatches) {
    await appendLog(op, "Desired pinned TeX Runtime is already active.\n");
    return;
  }
  await applyRuntime(op, {
    selector,
    languages,
    autoUpdate,
    rebuildIfMissing: selector.mode === "date",
  });
}

async function refreshLatest(op) {
  if (!state.desired.autoUpdate || state.desired.selector?.mode !== "latest") {
    await appendLog(op, "Automatic latest following is disabled.\n");
    return;
  }
  const latest = await pullOrRebuildBase(
    op,
    { mode: "latest", value: null },
    false,
  );
  const runtimeDrift =
    state.current?.selector?.mode !== "latest" ||
    !sameLanguages(state.desired.languages, state.current?.languages) ||
    state.current?.rendererRuntimeFingerprint !==
      (await rendererRuntimeFingerprint(join(repoRoot, "renderer")));
  if (state.current?.baseImageId === latest.imageId && !runtimeDrift) {
    await appendLog(
      op,
      "Already using the latest validated base with the desired language set.\n",
    );
    return;
  }
  await applyRuntime(
    op,
    {
      selector: { mode: "latest", value: null },
      languages: state.desired.languages,
      autoUpdate: true,
      rebuildIfMissing: false,
    },
    latest,
  );
}

async function setCountryOverride(country) {
  return serializeMutation(async () => {
    if (quiescing) {
      throw httpError(
        503,
        "IMAGE_MANAGER_QUIESCING",
        "Image Manager is quiescing for deployment",
      );
    }
    if (activeOperationId) {
      throw httpError(
        409,
        "IMAGE_OPERATION_ACTIVE",
        "Country override cannot change while an image operation is running",
      );
    }
    if (country !== null && !/^[A-Z]{2}$/.test(country)) {
      throw httpError(
        400,
        "INVALID_COUNTRY",
        "country must be a two-letter ISO code or null",
      );
    }
    state.desired.countryOverride = country;
    await persistState();
  });
}

async function quiesceManager() {
  return serializeMutation(async () => {
    if (activeOperationId) {
      throw httpError(
        409,
        "IMAGE_OPERATION_ACTIVE",
        "Cannot quiesce while an image operation is running",
      );
    }
    quiescing = true;
    return { quiescing: true };
  });
}

async function listRegistryTags() {
  const registryToken = await registryPullToken();
  const response = await fetchWithTimeout(
    `https://ghcr.io/v2/${ghcrOwner}/${ghcrName}/tags/list?n=1000`,
    { headers: { Authorization: `Bearer ${registryToken}` } },
  );
  assertPublicRegistryResponse(response);
  if (!response.ok) throw new Error(`GHCR tag list failed: ${response.status}`);
  const tags = (await response.json()).tags ?? [];
  if (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string")) {
    throw new Error("GHCR tag list response is invalid");
  }
  return tags;
}

async function registryPullToken() {
  const tokenResponse = await fetchWithTimeout(
    `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${ghcrOwner}/${ghcrName}:pull`)}`,
  );
  assertPublicRegistryResponse(tokenResponse);
  if (!tokenResponse.ok)
    throw new Error(`GHCR token request failed: ${tokenResponse.status}`);
  const tokenBody = await tokenResponse.json();
  const registryToken =
    typeof tokenBody?.token === "string" ? tokenBody.token : "";
  if (!registryToken)
    throw new Error("GHCR token response did not include a registry token");
  return registryToken;
}

function assertPublicRegistryResponse(response) {
  if (response.status === 401 || response.status === 403) {
    throw new Error(
      "GHCR Base is not publicly readable. Set the container package visibility to Public before applying it.",
    );
  }
}

async function listImages() {
  const tags = await listRegistryTags();
  return {
    repository: imageRepository,
    latest: tags.includes("latest"),
    daily: tags
      .filter((tag) => validDate(tag))
      .sort()
      .reverse(),
    weekly: tags
      .filter((tag) => /^weekly-/.test(tag) && validIsoWeek(tag.slice(7)))
      .map((tag) => tag.slice(7))
      .sort()
      .reverse(),
  };
}

async function languageCatalog() {
  if (languageCache && Date.now() - languageCache.createdAt < 15 * 60_000)
    return languageCache.items;
  const snapshot = await resolveSnapshot("latest");
  const work = await mkdtemp(join(tmpdir(), "texlive-languages-"));
  const compressed = join(work, "tlpdb.xz");
  try {
    const catalogUrl = `${snapshot.repository}/tlpkg/texlive.tlpdb.xz`;
    const curlMaxTimeSeconds = Math.max(5, Math.ceil(fetchTimeoutMs / 1000));
    await runCapture("curl", [
      "--fail",
      "--location",
      "--retry",
      "3",
      "--retry-delay",
      "1",
      "--connect-timeout",
      "10",
      "--max-time",
      String(curlMaxTimeSeconds),
      "--silent",
      "--show-error",
      "--output",
      compressed,
      catalogUrl,
    ]);
    const handle = await open(compressed, "r");
    const magic = Buffer.alloc(6);
    try {
      const { bytesRead } = await handle.read(magic, 0, magic.length, 0);
      if (
        bytesRead !== magic.length ||
        magic.toString("hex") !== "fd377a585a00"
      ) {
        throw new Error(
          "TeX Live package database response is not an XZ archive",
        );
      }
    } finally {
      await handle.close();
    }
    const text = await runCapture("xz", ["-dc", compressed]);
    const items = [];
    let current = null;
    for (const line of text.split(/\r?\n/)) {
      if (line.startsWith("name ")) {
        if (current) items.push(current);
        const name = line.slice(5).trim();
        current = name.startsWith("collection-lang")
          ? { id: name, name: name.replace(/^collection-lang/, "") }
          : null;
      } else if (current && line.startsWith("shortdesc ")) {
        current.description = line.slice(10).trim();
      }
    }
    if (current) items.push(current);
    items.sort((a, b) => a.name.localeCompare(b.name, "en"));
    languageCache = { createdAt: Date.now(), items };
    return items;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function inventory(name, query) {
  const file = name === "packages" ? "packages.txt" : "fonts.txt";
  let text = "";
  try {
    text = await readFile(join(environmentRoot, file), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const q = (query ?? "").trim().toLocaleLowerCase("en");
  const all = text.split(/\r?\n/).filter(Boolean);
  const items = q
    ? all.filter((item) => item.toLocaleLowerCase("en").includes(q))
    : all;
  return {
    items: items.slice(0, 500),
    total: items.length,
    truncated: items.length > 500,
  };
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 64 * 1024)
      throw httpError(413, "BODY_TOO_LARGE", "Request body is too large");
    chunks.push(bytes);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "INVALID_JSON", "Request body must be JSON");
  }
}

function send(res, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ") || !safeToken(auth.slice(7))) {
      throw httpError(401, "UNAUTHORIZED", "Invalid image manager credential");
    }
    const url = new globalThis.URL(req.url ?? "/", `http://${host}:${port}`);

    if (req.method === "GET" && url.pathname === "/v1/state") {
      return send(res, 200, { ...state, activeOperationId, quiescing });
    }
    if (req.method === "GET" && url.pathname === "/v1/images") {
      return send(res, 200, await listImages());
    }
    if (req.method === "GET" && url.pathname === "/v1/languages") {
      return send(res, 200, { items: await languageCatalog() });
    }
    if (req.method === "GET" && url.pathname === "/v1/inventory/packages") {
      return send(
        res,
        200,
        await inventory("packages", url.searchParams.get("q")),
      );
    }
    if (req.method === "GET" && url.pathname === "/v1/inventory/fonts") {
      return send(
        res,
        200,
        await inventory("fonts", url.searchParams.get("q")),
      );
    }

    const operationMatch = /^\/v1\/operations\/([A-Za-z0-9_-]+)$/.exec(
      url.pathname,
    );
    if (req.method === "GET" && operationMatch) {
      const op = await loadOperation(operationMatch[1]);
      if (!op)
        throw httpError(
          404,
          "OPERATION_NOT_FOUND",
          "Image operation was not found",
        );
      return send(res, 200, await operationWithLog(op));
    }

    if (req.method === "POST" && url.pathname === "/v1/quiesce") {
      return send(res, 200, await quiesceManager());
    }
    if (req.method === "POST" && url.pathname === "/v1/country") {
      const body = await readJson(req);
      await setCountryOverride(
        body.country == null || body.country === ""
          ? null
          : String(body.country).toUpperCase(),
      );
      return send(res, 200, { countryOverride: state.desired.countryOverride });
    }

    if (req.method === "POST" && url.pathname === "/v1/apply") {
      const body = await readJson(req);
      const selector = validateSelector(body.selector);
      const languages = validateLanguages(body.languages ?? []);
      const autoUpdate = Boolean(body.autoUpdate);
      if (autoUpdate && selector.mode !== "latest") {
        throw httpError(
          400,
          "INVALID_AUTO_UPDATE",
          "autoUpdate is only available with the latest selector",
        );
      }
      const operation = await startOperation("apply", async (op) => {
        await applyRuntime(op, { ...body, selector, languages, autoUpdate });
      });
      return send(res, 202, operation);
    }

    if (req.method === "POST" && url.pathname === "/v1/reconcile") {
      return send(
        res,
        202,
        await startOperation("reconcile", reconcileDesired),
      );
    }

    if (req.method === "POST" && url.pathname === "/v1/rollback") {
      return send(res, 202, await startOperation("rollback", rollback));
    }
    if (req.method === "POST" && url.pathname === "/v1/revalidate") {
      return send(res, 202, await startOperation("revalidate", revalidate));
    }
    if (req.method === "POST" && url.pathname === "/v1/cleanup") {
      return send(res, 202, await startOperation("cleanup", cleanup));
    }
    if (req.method === "POST" && url.pathname === "/v1/refresh") {
      return send(res, 202, await startOperation("refresh", refreshLatest));
    }

    throw httpError(404, "NOT_FOUND", "Route not found");
  } catch (error) {
    const status = Number(error?.status ?? 500);
    if (status >= 500) {
      console.error(
        JSON.stringify({
          event: "image_manager.error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    send(res, status, {
      error: {
        code: error?.code ?? "IMAGE_MANAGER_ERROR",
        message: error instanceof Error ? error.message : "Image manager error",
      },
    });
  }
});

server.listen(port, host, () => {
  console.log(
    JSON.stringify({ event: "image_manager.started", host, port, dockerHost }),
  );
});
