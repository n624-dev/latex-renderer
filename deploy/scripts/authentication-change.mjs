import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  parseEnvironmentFile,
  productionAuthenticationPlan,
  serverSetupAuthenticationReviewEnvironment,
  validateServerSetupAuthenticationReview,
  importServerSetupReview,
  validateServerSetupReview,
  serverRuntimeReviewEnvironment,
} from "../../packages/server-setup-core/src/index.mjs";

export const authenticationUnits = Object.freeze([
  "latex-renderer-admin-api.service",
  "latex-renderer-remote-mcp.service",
]);
// All long-lived consumers of the reviewed admission/output/worker limits.
// Image/Update managers, Nginx, Cloudflare and unrelated services are untouched.
export const serverSetupUnits = Object.freeze([
  "latex-renderer-api.service",
  ...authenticationUnits,
  "latex-renderer-internal-api.service",
  "latex-renderer-worker.service",
]);
const authKeys = new Set([
  "AUTH_MODE",
  "AUTH_BACKEND",
  "AUTH_PASSWORD_ENABLED",
  "AUTH_OIDC_ENABLED",
  "OIDC_DISPLAY_NAME",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_ALLOWED_ALGORITHMS",
  "CLOUDFLARE_ACCESS_ISSUER",
  "CLOUDFLARE_ADMIN_AUDIENCE",
  "CLOUDFLARE_REMOTE_MCP_AUDIENCE",
]);
// Exact-byte optimistic-concurrency fingerprint, NOT a password verifier.
// Password credentials are managed separately by the runtime's scrypt policy.
export const authenticationEnvironmentHash = (contents) =>
  createHash("sha256").update(contents).digest("hex");

// This host adapter, unlike the secret-free Core, handles a complete private
// EnvironmentFile. Preserve every unrelated line; never export or log it.
export function authenticationChangeReview(contents, input) {
  checkedEnvironment(contents);
  const review = validateServerSetupAuthenticationReview(input);
  const before = productionAuthenticationPlan(parseEnvironmentFile(contents));
  if (
    review.deployment.mode !== before.deploymentMode ||
    review.deployment.publicOrigin !== before.publicOrigin
  )
    throw new Error(
      "Authentication changes cannot change deployment or origin",
    );
  const values = serverSetupAuthenticationReviewEnvironment(review);
  const lines = contents
    .split("\n")
    .filter((line) => !authKeys.has(/^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1]));
  while (lines.at(-1) === "") lines.pop();
  for (const [key, value] of values) {
    if (!authKeys.has(key)) continue;
    // The repository's strict unquoted EnvironmentFile format is not a shell.
    // Reject systemd quoting/escape syntax rather than display one value and
    // start services with another. Spaces in a plain display label are allowed.
    if (/["'\\]/.test(value))
      throw new Error(
        "Authentication review contains unsupported EnvironmentFile quoting",
      );
    lines.push(`${key}=${value}`);
  }
  const after = `${lines.join("\n")}\n`;
  checkedEnvironment(after);
  productionAuthenticationPlan(parseEnvironmentFile(after));
  return {
    envelope: Object.freeze({
      format: 1,
      baseSha256: authenticationEnvironmentHash(contents),
      candidateSha256: authenticationEnvironmentHash(after),
      review,
    }),
    after,
  };
}

export function serverSetupChangeReview(contents, input) {
  const review = validateServerSetupReview(input);
  const previous = importServerSetupReview(contents);
  if (
    JSON.stringify(previous.deployment.ingress) !==
    JSON.stringify(review.deployment.ingress)
  )
    throw new Error(
      "Server setup changes require unchanged ingress; transactional network cutover is not implemented",
    );
  for (const key of ["databasePath", "storageRoot", "rendererImage"])
    if (previous.runtime[key] !== review.runtime[key])
      throw new Error(
        "Existing setup cannot move storage/database or switch managed renderer images",
      );
  // The unit's TimeoutStopSec is 15min. Preserve a grace margin rather than
  // silently extending job timeouts beyond its existing graceful-stop budget.
  if (
    previous.runtime.limits.jobTimeoutSeconds > 840 ||
    review.runtime.limits.jobTimeoutSeconds > 840
  )
    throw new Error(
      "Review the worker stop budget before using job timeouts above 840 seconds",
    );
  const authentication = authenticationChangeReview(
    contents,
    review.deployment.authentication,
  );
  const values = serverRuntimeReviewEnvironment(review.runtime);
  const lines = authentication.after
    .split("\n")
    .filter((line) => !values.has(/^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1]));
  while (lines.at(-1) === "") lines.pop();
  for (const [key, value] of values) lines.push(`${key}=${value}`);
  const after = `${lines.join("\n")}\n`;
  importServerSetupReview(after);
  return {
    envelope: Object.freeze({
      format: 2,
      baseSha256: authenticationEnvironmentHash(contents),
      candidateSha256: authenticationEnvironmentHash(after),
      review,
    }),
    after,
  };
}

function checkedEnvironment(contents) {
  if (
    typeof contents !== "string" ||
    Buffer.byteLength(contents) < 1 ||
    Buffer.byteLength(contents) > 128 * 1024
  )
    throw new Error("Invalid authentication EnvironmentFile size");
  parseEnvironmentFile(contents); // validates even excluded/secret-bearing lines
}
function checkedJournal(value) {
  if (
    !value ||
    Object.keys(value).sort().join(",") !== "after,before,format,phase" ||
    ![1, 2].includes(value.format) ||
    !["pending", "committed"].includes(value.phase)
  )
    throw new Error("Invalid authentication recovery journal");
  for (const text of [value.before, value.after]) {
    checkedEnvironment(text);
    productionAuthenticationPlan(parseEnvironmentFile(text));
    if (value.format === 2) importServerSetupReview(text);
  }
  if (
    value.format === 2 &&
    serverSetupChangeReview(value.before, importServerSetupReview(value.after))
      .after !== value.after
  )
    throw new Error("Invalid server setup recovery journal");
  return value;
}

// Paths/ownership are injectable only through the module for disposable tests.
// The privileged entry point uses fixed paths and exposes no arbitrary units,
// executables, secret operations, DB writes, or filesystem roots.
export class AuthenticationChangeStore {
  constructor(environmentPath, root, uid = 0, gid = 0) {
    this.environmentPath = resolve(environmentPath);
    this.root = resolve(root);
    this.uid = uid;
    this.gid = gid;
  }
  async initialize() {
    for (const path of [dirname(this.environmentPath), dirname(this.root)]) {
      const info = await lstat(path);
      if (
        !info.isDirectory() ||
        info.uid !== this.uid ||
        info.mode & 0o022 ||
        (await realpath(path)) !== path
      )
        throw new Error("Unsafe authentication configuration directory");
    }
    await mkdir(this.root, { mode: 0o700 }).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
    const info = await lstat(this.root);
    if (
      !info.isDirectory() ||
      info.uid !== this.uid ||
      (info.mode & 0o7777) !== 0o700 ||
      (await realpath(this.root)) !== this.root
    )
      throw new Error("Unsafe authentication recovery directory");
    await this.sync(dirname(this.root));
    // Temporary paths have no authority until the durable rename. A prior
    // process may have died before it; only these two validated files are removed.
    for (const path of [
      join(this.root, ".journal.tmp"),
      join(dirname(this.environmentPath), ".authentication-env.tmp"),
    ]) {
      try {
        // SIGKILL can precede chown/chmod/write. An empty root-created regular
        // temp is disposable; a link or broadly writable file is not.
        const info = await lstat(path);
        if (
          !info.isFile() ||
          info.uid !== this.uid ||
          info.nlink !== 1 ||
          info.mode & 0o7027 ||
          info.size > 1024 * 1024 ||
          ![this.uid, this.gid].includes(info.gid)
        )
          throw new Error("Unsafe authentication temporary file");
        await unlink(path);
        await this.sync(dirname(path));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  async read(path, mode, gid, maximum = 128 * 1024, minimum = 1) {
    const file = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (
        !info.isFile() ||
        info.uid !== this.uid ||
        info.gid !== gid ||
        (info.mode & 0o7777) !== mode ||
        info.nlink !== 1 ||
        info.size < minimum ||
        info.size > maximum
      )
        throw new Error("Unsafe authentication configuration file");
      const bytes = Buffer.alloc(maximum + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(
          bytes,
          length,
          bytes.length - length,
          null,
        );
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await file.stat();
      if (
        length !== info.size ||
        length > maximum ||
        [
          "dev",
          "ino",
          "nlink",
          "uid",
          "gid",
          "mode",
          "size",
          "mtimeMs",
          "ctimeMs",
        ].some((key) => info[key] !== after[key])
      )
        throw new Error("Authentication configuration changed while reading");
      return bytes.subarray(0, length).toString("utf8");
    } finally {
      await file.close();
    }
  }
  async environment() {
    const contents = await this.read(this.environmentPath, 0o640, this.gid);
    checkedEnvironment(contents);
    return contents;
  }
  async journal() {
    try {
      const info = await lstat(this.root);
      if (
        !info.isDirectory() ||
        info.uid !== this.uid ||
        (info.mode & 0o7777) !== 0o700 ||
        (await realpath(this.root)) !== this.root
      )
        throw new Error("Unsafe authentication recovery directory");
      return checkedJournal(
        JSON.parse(
          await this.read(
            join(this.root, "journal.json"),
            0o600,
            this.uid,
            1024 * 1024,
          ),
        ),
      );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
  async sync(path) {
    const directory = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  async atomic(path, temporary, contents, mode, gid) {
    const file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      mode,
    );
    try {
      await file.chown(this.uid, gid);
      await file.chmod(mode);
      await file.writeFile(contents);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
    await this.sync(dirname(path));
  }
  async saveJournal(value) {
    checkedJournal(value);
    await this.atomic(
      join(this.root, "journal.json"),
      join(this.root, ".journal.tmp"),
      JSON.stringify(value),
      0o600,
      this.uid,
    );
  }
  async replaceEnvironment(contents) {
    checkedEnvironment(contents);
    await this.atomic(
      this.environmentPath,
      join(dirname(this.environmentPath), ".authentication-env.tmp"),
      contents,
      0o640,
      this.gid,
    );
  }
  async clear() {
    await unlink(join(this.root, "journal.json"));
    await this.sync(this.root);
  }
}

async function stopConsumers(host, units = authenticationUnits) {
  for (const unit of units) await host.run("stop", unit);
  for (const unit of units)
    if (await host.active(unit))
      throw new Error("Authentication consumers did not stop");
}
async function startConsumers(host, contents, units = authenticationUnits) {
  // Attempt every consumer; one failed service must not hide the others.
  let failed = false;
  for (const unit of units) {
    try {
      await host.run("start", unit);
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("Authentication consumers did not start");
  for (const unit of units)
    if (!(await host.active(unit)))
      throw new Error("Authentication consumer is not active");
  await host.health(contents);
}

export async function recoverAuthenticationChange(
  store,
  host,
  beforeStart = false,
) {
  await store.initialize();
  const journal = await store.journal();
  if (!journal) return false;
  const units = journal.format === 2 ? serverSetupUnits : authenticationUnits;
  const current = await store.environment();
  if (current !== journal.before && current !== journal.after)
    throw new Error(
      "AUTHENTICATION_REVIEW_REQUIRED: configuration changed outside the transaction",
    );
  if (journal.phase === "committed") {
    if (current !== journal.after)
      throw new Error(
        "AUTHENTICATION_REVIEW_REQUIRED: committed configuration mismatch",
      );
    await store.clear();
    return true;
  }
  if (beforeStart) {
    for (const unit of units)
      if (await host.active(unit))
        throw new Error(
          "Boot authentication recovery requires stopped consumers",
        );
  } else await stopConsumers(host, units);
  await store.replaceEnvironment(journal.before);
  // Do NOT restore a DB backup: retired cookies must remain permanently revoked.
  if (!beforeStart) await startConsumers(host, journal.before, units);
  await store.clear();
  return true;
}

export async function applyAuthenticationChange(store, host, envelope) {
  return applyReviewedEnvironment(
    store,
    host,
    envelope,
    1,
    authenticationChangeReview,
    authenticationUnits,
  );
}

export async function applyServerSetupChange(store, host, envelope) {
  await applyReviewedEnvironment(
    store,
    host,
    envelope,
    2,
    serverSetupChangeReview,
    serverSetupUnits,
  );
  return importServerSetupReview(await store.environment());
}

async function applyReviewedEnvironment(
  store,
  host,
  envelope,
  format,
  prepare,
  units,
) {
  await store.initialize();
  if (await store.journal())
    throw new Error(
      "AUTHENTICATION_REVIEW_REQUIRED: recover the previous transaction first",
    );
  if (
    !envelope ||
    Object.keys(envelope).sort().join(",") !==
      "baseSha256,candidateSha256,format,review" ||
    envelope.format !== format ||
    !/^[a-f0-9]{64}$/.test(envelope.baseSha256) ||
    !/^[a-f0-9]{64}$/.test(envelope.candidateSha256)
  )
    throw new Error("Invalid reviewed authentication change");
  const before = await store.environment();
  const prepared = prepare(before, envelope.review);
  if (
    envelope.baseSha256 !== prepared.envelope.baseSha256 ||
    envelope.candidateSha256 !== prepared.envelope.candidateSha256
  )
    throw new Error(
      "Authentication review is stale or has been edited; review again",
    );
  const after = prepared.after;
  await host.preflight(after); // secrets + existing active owner; no mutation
  for (const unit of units)
    if (!(await host.active(unit)))
      throw new Error(
        "Configuration changes require every selected existing consumer to be active",
      );
  await host.health(before);
  if ((await store.environment()) !== before)
    throw new Error("Authentication configuration changed during preflight");
  // Re-reviewed unchanged runtime choices need no outage or recovery record.
  // Preflight, current health and the full-file concurrency check still run.
  if (format === 2 && after === before)
    return productionAuthenticationPlan(parseEnvironmentFile(after));
  const journal = { format, phase: "pending", before, after };
  await store.saveJournal(journal); // durable BEFORE stopping or publishing
  try {
    await stopConsumers(host, units);
    if ((await store.environment()) !== before)
      throw new Error("Authentication configuration changed during cutover");
    await store.replaceEnvironment(after);
    await startConsumers(host, after, units);
    if ((await store.environment()) !== after)
      throw new Error(
        "Authentication configuration changed during readiness checks",
      );
    await store.saveJournal({ ...journal, phase: "committed" });
  } catch {
    try {
      await recoverAuthenticationChange(store, host);
    } catch {
      throw new Error(
        "AUTHENTICATION_REVIEW_REQUIRED: recovery incomplete; private journal retained",
      );
    }
    throw new Error(
      "Authentication change failed; recovery completed; verify the active configuration; retired sessions remain revoked",
    );
  }
  // If cleanup fails after durable commit, recovery keeps the NEW configuration.
  await store.clear();
  return productionAuthenticationPlan(parseEnvironmentFile(after));
}
