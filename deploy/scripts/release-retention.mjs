import { constants } from "node:fs";
import {
  lstat,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import { isMainModule } from "./is-main-module.mjs";
import { collectReleasePublications } from "./release-publication.mjs";
import { RecoveryStore } from "./update-recovery.mjs";
import { randomUUID } from "node:crypto";

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
function validId(value) {
  if (
    typeof value !== "string" ||
    !idPattern.test(value) ||
    value.includes("..")
  )
    throw new Error("Invalid retained release identity");
  return value;
}
async function optional(path, read) {
  try {
    return await read(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
async function sealed(path, uid, directory = false) {
  const s = await lstat(path);
  if (
    (directory ? !s.isDirectory() : !s.isFile()) ||
    s.uid !== uid ||
    s.mode & 0o022 ||
    (!directory && s.nlink !== 1) ||
    (await realpath(path)) !== path
  )
    throw new Error("Unsafe release retention state or path");
  return s;
}
async function json(path, uid) {
  const s = await sealed(path, uid);
  if (s.size > 64 * 1024) throw new Error("Unbounded retention metadata");
  return JSON.parse(await readFile(path, "utf8"));
}
async function sync(path) {
  const f = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    await f.sync();
  } finally {
    await f.close();
  }
}
async function atomic(path, value, uid) {
  await sealed(dirname(path), uid, true);
  const next = `${path}.next`;
  const previous = await optional(next, (p) => sealed(p, uid));
  if (previous) await rm(next);
  const f = await open(next, "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify(value) + "\n");
    await f.sync();
  } finally {
    await f.close();
  }
  await rename(next, path);
  await sync(dirname(path));
}
async function activeRelease(releasesRoot, currentLink, uid) {
  const target = await optional(currentLink, readlink);
  if (target === null) return null;
  const path = resolve(dirname(currentLink), target);
  if (dirname(path) !== releasesRoot)
    throw new Error("Current release escapes release root");
  await sealed(path, uid, true);
  return validId(basename(path));
}
async function releaseIdentity(root, id, uid) {
  await sealed(join(root, validId(id)), uid, true);
  const value = await json(join(root, id, ".latex-renderer-release.json"), uid);
  if (
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(value.version ?? "") ||
    !/^[a-f0-9]{40}$/.test(value.commit ?? "") ||
    `v${value.version}-${value.commit.slice(0, 12)}` !== id
  )
    throw new Error("Release metadata identity mismatch");
  return id;
}
function validateLedger(value) {
  if (
    value?.format !== 1 ||
    !Array.isArray(value.successful) ||
    value.successful.length > 3 ||
    new Set(value.successful.map((v) => v.id)).size !== value.successful.length
  )
    throw new Error("Corrupt release retention ledger");
  for (const entry of value.successful) {
    validId(entry.id);
    if (!Number.isSafeInteger(entry.verifiedAt) || entry.verifiedAt < 0)
      throw new Error("Corrupt verified release age");
  }
  if (value.previous !== null) validId(value.previous);
  value.deleting ??= [];
  if (
    !Array.isArray(value.deleting) ||
    value.deleting.length > 100 ||
    new Set(value.deleting.map((e) => e.id)).size !== value.deleting.length
  )
    throw new Error("Corrupt release deletion journal");
  for (const entry of value.deleting) {
    validId(entry.id);
    if (
      typeof entry.trash !== "string" ||
      !entry.trash.startsWith(`.trash-${entry.id}-`) ||
      !/^[a-f0-9-]{36}$/.test(entry.trash.slice(`.trash-${entry.id}-`.length))
    )
      throw new Error("Invalid release trash identity");
  }
  return value;
}

// Must be called under the host mutation lock / deployment quiescence. The
// root ledger is written BEFORE moving current and is independent of the
// controller's late previousReleaseId update. Failed candidates never enter
// this list and directory/file mtimes never rank completed releases.
export async function captureReleaseRetention({
  releasesRoot,
  currentLink,
  statePath,
  uid = process.getuid(),
  now = Date.now(),
}) {
  await sealed(releasesRoot, uid, true);
  let ledger = await optional(statePath, (p) => json(p, uid));
  const current = await activeRelease(releasesRoot, currentLink, uid);
  if (ledger) ledger = validateLedger(ledger);
  else ledger = { format: 1, previous: null, successful: [] };
  if (current && ledger.successful.length === 0) {
    await releaseIdentity(releasesRoot, current, uid);
    ledger.successful.push({ id: current, verifiedAt: now });
  }
  // Do not replace a known previous successful release with an unverified
  // current left behind by a failed deployment.
  if (current && ledger.successful.some((e) => e.id === current))
    ledger.previous = current;
  await atomic(statePath, ledger, uid);
  return ledger;
}

async function deletionTree(path, uid, mounts) {
  const base = await sealed(path, uid, true);
  if (mounts.some((p) => p === path || p.startsWith(path + sep)))
    throw new Error("Mounted release path; cleanup stopped");
  let count = 0;
  async function walk(p, depth) {
    if (++count > 200_000 || depth > 128)
      throw new Error("Release cleanup tree exceeds bounds");
    const s = await lstat(p);
    if (s.dev !== base.dev || s.uid !== uid)
      throw new Error("Unexpected release device or owner");
    if (s.isSymbolicLink()) {
      const dest = resolve(dirname(p), await readlink(p));
      if (dest !== path && !dest.startsWith(path + sep))
        throw new Error("External release symlink; cleanup stopped");
    } else if (s.isDirectory()) {
      if (s.mode & 0o022) throw new Error("Writable release directory");
      for (const name of await readdir(p)) await walk(join(p, name), depth + 1);
    } else if (!s.isFile())
      throw new Error("Special release entry; cleanup stopped");
  }
  await walk(path, 0);
}
export async function collectReleases({
  releasesRoot,
  currentLink,
  statePath,
  releaseId,
  protectedIds = [],
  uid = process.getuid(),
  now = Date.now(),
  mountPaths,
  markVerified = true,
  checkpoint = async () => {},
}) {
  await sealed(releasesRoot, uid, true);
  const ledger = validateLedger(await json(statePath, uid));
  const active = await activeRelease(releasesRoot, currentLink, uid);
  if (active !== validId(releaseId))
    throw new Error("Requested verified release is not active");
  await releaseIdentity(releasesRoot, active, uid);
  const keep = new Set([active, ...protectedIds.map(validId)]);
  if (ledger.previous) keep.add(ledger.previous);
  const successful = markVerified
    ? [
        { id: active, verifiedAt: now },
        ...ledger.successful.filter((e) => e.id !== active),
      ].slice(0, 3)
    : ledger.successful;
  for (const entry of successful) keep.add(entry.id);
  // Retained points can name already-collected historical code; missing code
  // is never redownloaded and does not authorize a schema-incompatible rollback.
  for (const id of keep)
    if (await optional(join(releasesRoot, id), lstat))
      await releaseIdentity(releasesRoot, id, uid);
  const mounts =
    mountPaths ??
    (await readFile("/proc/self/mountinfo", "utf8"))
      .trim()
      .split("\n")
      .map((line) =>
        line
          .split(" ")[4]
          ?.replace(/\\([0-7]{3})/g, (_, n) =>
            String.fromCharCode(parseInt(n, 8)),
          ),
      )
      .filter(Boolean);
  const remove = [...ledger.deleting];
  const ownedTrash = new Set(remove.map((e) => e.trash));
  for (const entry of remove) {
    if (keep.has(entry.id))
      throw new Error("A deleting release became protected; review required");
    const original = join(releasesRoot, entry.id),
      trash = join(releasesRoot, entry.trash);
    const originalInfo = await optional(original, lstat),
      trashInfo = await optional(trash, lstat);
    if (originalInfo && trashInfo)
      throw new Error("Ambiguous release deletion state");
    if (originalInfo) {
      await releaseIdentity(releasesRoot, entry.id, uid);
      await deletionTree(original, uid, mounts);
    }
    if (trashInfo) await deletionTree(trash, uid, mounts);
  }
  for (const name of await readdir(releasesRoot)) {
    if (name.startsWith(".pending-")) continue; // Separate journal + lock collector.
    if (name.startsWith(".trash-")) {
      if (!ownedTrash.has(name)) throw new Error("Unrecognized release trash");
      continue;
    }
    validId(name);
    const path = join(releasesRoot, name);
    await sealed(path, uid, true); // Even an unexpected symlink aborts all deletion.
    if (
      !keep.has(name) &&
      !remove.some((e) => e.id === name) &&
      remove.length < 100
    ) {
      await releaseIdentity(releasesRoot, name, uid);
      await deletionTree(path, uid, mounts);
      remove.push({ id: name, trash: `.trash-${name}-${randomUUID()}` });
    }
  }
  // Persist the new successful identity before any destructive operation.
  const nextLedger = { ...ledger, successful, deleting: remove };
  await atomic(statePath, nextLedger, uid);
  await checkpoint("deletion-recorded");
  for (const entry of [...remove]) {
    const original = join(releasesRoot, entry.id),
      trash = join(releasesRoot, entry.trash);
    if (await optional(original, lstat)) {
      await rename(original, trash);
      await sync(releasesRoot);
    }
    await checkpoint("trashed");
    await rm(trash, { recursive: true, force: true });
    await sync(releasesRoot);
    await checkpoint("deleted");
    nextLedger.deleting = nextLedger.deleting.filter((e) => e.id !== entry.id);
    await atomic(statePath, nextLedger, uid);
  }
  return { removed: remove.length, retained: [...keep].sort() };
}

async function hostProtectedReleases() {
  const ids = new Set();
  const statePath = "/var/lib/latex-renderer/update-manager/state.json";
  const info = await optional(statePath, lstat);
  if (info) {
    // Controller state is only allowed to ADD protection, never select a path
    // for deletion. Keep the root-owned ledger authoritative for ranking.
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.nlink !== 1 ||
      info.mode & 0o002 ||
      info.size > 1024 * 1024 ||
      (await realpath(statePath)) !== statePath
    )
      throw new Error("Unsafe controller retention state");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    if (!state || typeof state !== "object" || Array.isArray(state))
      throw new Error("Corrupt controller retention state");
    if (state.previousReleaseId != null)
      ids.add(validId(state.previousReleaseId));
  }
  const root = "/var/lib/latex-renderer-update-recovery";
  if (await optional(root, lstat)) {
    await sealed(root, 0, true);
    const points = await new RecoveryStore(root).points();
    const pending = await optional(join(root, "operation.json"), (p) =>
      json(p, 0),
    );
    if (
      pending &&
      (pending.format !== 1 ||
        !Object.hasOwn(pending, "pointId") ||
        (pending.pointId !== null &&
          !points.some((p) => p.id === pending.pointId)))
    )
      throw new Error("Unknown pending recovery reference");
    for (const point of points) {
      if (
        !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(
          point.release?.version ?? "",
        ) ||
        !/^[a-f0-9]{40}$/.test(point.release?.commit ?? "")
      )
        throw new Error("Corrupt recovery release reference");
      ids.add(
        validId(
          `v${point.release.version}-${point.release.commit.slice(0, 12)}`,
        ),
      );
    }
  }
  return [...ids];
}

export async function collectHostReleaseArtifacts(releaseId = null) {
  const options = {
    releasesRoot: "/opt/latex-renderer/releases",
    currentLink: "/opt/latex-renderer/current",
    statePath: "/opt/latex-renderer/update-staging/release-retention.json",
    uid: 0,
  };
  if (!(await optional(options.statePath, lstat)))
    return { skipped: "no-retention-ledger" };
  const protectedIds = await hostProtectedReleases();
  const result = await collectReleases({
    ...options,
    releaseId:
      releaseId ??
      (await activeRelease(options.releasesRoot, options.currentLink, 0)),
    protectedIds,
    markVerified: releaseId !== null,
  });
  const pendingRemoved = await collectReleasePublications({
    releasesRoot: options.releasesRoot,
    journalRoot: "/opt/latex-renderer/update-staging/release-publications",
  });
  return { ...result, pendingRemoved };
}

// Caller owns helper.lock THEN mutation.lock. This is only the periodic GC,
// never the deployment's postflight (which still uses its own root stage).
// Legacy/unidentified nonempty stages are not imported or deleted.
export async function collectHelperStages({
  root,
  uid = process.getuid(),
  mountPaths,
}) {
  const base = await sealed(root, uid, true);
  const mounts =
    mountPaths ??
    (await readFile("/proc/self/mountinfo", "utf8"))
      .trim()
      .split("\n")
      .map((line) =>
        line
          .split(" ")[4]
          ?.replace(/\\([0-7]{3})/g, (_, n) =>
            String.fromCharCode(parseInt(n, 8)),
          ),
      )
      .filter(Boolean);
  let removed = 0;
  for (const name of await readdir(root)) {
    if (
      !/^(?:\.gc-)?(?:privileged(?:-rollback)?|bootstrap)-[A-Za-z0-9]{6}$/.test(
        name,
      )
    )
      continue;
    const path = join(root, name);
    await sealed(path, uid, true);
    if (!name.startsWith(".gc-")) {
      const marker = await optional(join(path, ".helper-stage-v2"), (p) =>
        json(p, uid),
      );
      if (marker === null) continue;
      if (marker.format !== 2)
        throw new Error("Unknown managed helper stage marker");
    }
    if (mounts.some((p) => p === path || p.startsWith(path + sep)))
      throw new Error("Mounted helper stage; collection stopped");
    let count = 0;
    async function walk(p, depth) {
      if (++count > 200_000 || depth > 128)
        throw new Error("Helper stage tree exceeds bounds");
      const s = await lstat(p);
      if (s.dev !== base.dev) throw new Error("Unexpected helper stage device");
      // Non-root build outputs are expected. Never follow a symlink: unlinking
      // it is safe even if it points to a tool outside this private stage.
      if (s.isSymbolicLink()) return;
      if (s.isDirectory())
        for (const child of await readdir(p))
          await walk(join(p, child), depth + 1);
      else if (!s.isFile()) throw new Error("Special helper stage entry");
    }
    await walk(path, 0);
    const trash = name.startsWith(".gc-") ? path : join(root, `.gc-${name}`);
    if (trash !== path) {
      if (await optional(trash, lstat))
        throw new Error("Ambiguous helper stage trash");
      await rename(path, trash);
      await sync(root);
    }
    await rm(trash, { recursive: true });
    await sync(root);
    removed++;
  }
  return removed;
}

if (isMainModule(import.meta.url)) {
  const [verb, releaseId] = process.argv.slice(2);
  if (
    process.getuid() !== 0 ||
    !(
      (verb === "capture" && process.argv.length === 3) ||
      (verb === "collect" && process.argv.length === 4)
    )
  )
    throw new Error(
      "usage (root): release-retention.mjs capture|collect RELEASE_ID",
    );
  const options = {
    releasesRoot: "/opt/latex-renderer/releases",
    currentLink: "/opt/latex-renderer/current",
    statePath: "/opt/latex-renderer/update-staging/release-retention.json",
    uid: 0,
  };
  if (verb === "capture") await captureReleaseRetention(options);
  else {
    const result = await collectHostReleaseArtifacts(releaseId);
    console.log(
      JSON.stringify({
        event: "release.retention_completed",
        ...result,
      }),
    );
  }
}
