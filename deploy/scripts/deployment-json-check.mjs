import { spawn } from "node:child_process";
import { constants } from "node:os";
import { performance } from "node:perf_hooks";
import { open, readdir, readFile } from "node:fs/promises";
import { setTimeout, clearTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { isMainModule } from "./is-main-module.mjs";

const systemCodes = new Set([
  "EACCES",
  "EPERM",
  "ENOSPC",
  "EDQUOT",
  "ENOENT",
  "EEXIST",
  "EROFS",
  "EMFILE",
  "ENFILE",
  "ENOTDIR",
  "EISDIR",
  "EXDEV",
  "ENOTEMPTY",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "ABORT_ERR",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);
const errorCodes = new Set([
  "SETUP_FAILED",
  "SETUP_REMOVE_FAILED",
  "INTERNAL_ERROR",
  "CLI_USAGE_ERROR",
  "UNMANAGED_INSTALLATION",
  "MANAGED_STATE_REQUIRED",
  "INVALID_SETUP_PATH",
  "INVALID_SETUP_TARGET",
  "UNSUPPORTED_PLATFORM",
]);
const phases = new Set([
  "arguments",
  "distribution",
  "install",
  "credential",
  "remove",
]);

// Legacy clients have no diagnostic object. Recognize exact, bounded message
// templates, never print an arbitrary message/stack/body or regex-redact secrets.
export function deploymentJsonDiagnostic(value) {
  const error = value?.error;
  const diagnostic = error?.diagnostic;
  const result = {};
  if (errorCodes.has(error?.code)) result.code = error.code;
  if (phases.has(diagnostic?.phase)) result.phase = diagnostic.phase;
  if (systemCodes.has(diagnostic?.systemCode))
    result.systemCode = diagnostic.systemCode;
  const message = typeof error?.message === "string" ? error.message : "";
  const http =
    /^(Manifest|Archive) download failed: HTTP ([1-5][0-9]{2})$/.exec(message);
  if (http) {
    result.category = http[1] === "Manifest" ? "manifest-http" : "archive-http";
    result.httpStatus = Number(http[2]);
  } else if (message === "fetch failed") result.category = "network-fetch";
  else if (
    /^Client archive (?:size|SHA-256) verification failed$/.test(message)
  )
    result.category = "archive-verification";
  else if (message === "Client manifest is invalid")
    result.category = "invalid-manifest";
  else if (
    /^(?:Manifest|Archive) response (?:Content-Length is invalid|body is unavailable|length does not match Content-Length|exceeds the [0-9]{1,9}-byte download limit)$/.test(
      message,
    )
  )
    result.category = "download-body";
  // Node filesystem messages begin with an errno; paths after it stay private.
  else if (systemCodes.has(message.split(":", 1)[0]))
    result.systemCode ??= message.split(":", 1)[0];
  return result;
}

async function groupStopped(pid) {
  if (!pid || process.platform !== "linux") return true;
  // kill(2) returning is not evidence that a descendant stopped executing.
  // Bound confirmation to two seconds; zombies cannot write deployment files.
  const deadline = performance.now() + 2000;
  do {
    let running = false;
    for (const name of await readdir("/proc")) {
      if (performance.now() > deadline) return false;
      if (!/^[0-9]+$/.test(name)) continue;
      let stat;
      try {
        stat = await readFile(`/proc/${name}/stat`, "utf8");
      } catch (error) {
        if (["ENOENT", "ESRCH"].includes(error.code)) continue;
        return false;
      }
      const fields = stat.slice(stat.lastIndexOf(") ") + 2).split(" ");
      if (Number(fields[2]) === pid && !["Z", "X"].includes(fields[0])) {
        running = true;
        break;
      }
    }
    if (!running) return true;
    await delay(10);
  } while (performance.now() < deadline);
  return false;
}

function parseReceipt(output) {
  let depth = 0,
    quoted = false,
    escaped = false;
  for (const character of output) {
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
    } else if (character === '"') quoted = true;
    else if (character === "{" || character === "[") {
      if (++depth > 32) throw new Error("Deployment JSON nesting limit");
    } else if (character === "}" || character === "]") depth--;
  }
  return JSON.parse(output);
}

// No shell, raw stderr, argv or environment is copied into diagnostics. Bound
// both output streams together, and terminate the runuser process group before
// cleanup so a timed-out wrapper cannot leave the installer writing files.
export async function runDeploymentJsonCheck(
  command,
  args,
  { timeoutMs = 120_000, maxOutputBytes = 64 * 1024, killGraceMs = 1000 } = {},
) {
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 120_000 ||
    !Number.isSafeInteger(maxOutputBytes) ||
    maxOutputBytes < 1 ||
    maxOutputBytes > 64 * 1024 ||
    !Number.isSafeInteger(killGraceMs) ||
    killGraceMs < 1 ||
    killGraceMs > 1000
  )
    throw new Error("Invalid deployment JSON check limits");
  return await new Promise((resolve) => {
    const grouped = process.platform !== "win32";
    const child = spawn(command, args, {
      detached: grouped,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    let size = 0,
      failure,
      forcedCode,
      escalation,
      finishing = false;
    const signal = (name) => {
      try {
        if (child.pid) {
          if (grouped) process.kill(-child.pid, name);
          else child.kill(name);
        }
      } catch (error) {
        if (error.code !== "ESRCH") failure ??= "termination-failed";
      }
    };
    const terminate = (reason, exitCode) => {
      if (failure) return;
      failure = reason;
      forcedCode = exitCode;
      if (finishing) return;
      signal("SIGTERM");
      escalation = setTimeout(() => signal("SIGKILL"), killGraceMs);
    };
    const handlers = new Map(
      ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => {
        const handler = () =>
          terminate("interrupted", 128 + constants.signals[name]);
        process.on(name, handler);
        return [name, handler];
      }),
    );
    const deadline = setTimeout(() => terminate("timeout", 124), timeoutMs);
    child.on("error", () => terminate("spawn-failed", 126));
    for (const [stream, capture] of [
      [child.stdout, true],
      [child.stderr, false],
    ]) {
      stream.on("error", () => terminate("output-failed", 125));
      stream.on("data", (chunk) => {
        if (failure) return;
        size += chunk.length;
        if (size > maxOutputBytes) terminate("output-limit", 125);
        else if (capture) chunks.push(chunk);
      });
    }
    const finish = async (code, name) => {
      finishing = true;
      // Also remove descendants that closed their inherited output handles.
      signal("SIGKILL");
      clearTimeout(deadline);
      clearTimeout(escalation);
      if (!(await groupStopped(child.pid).catch(() => false))) {
        failure = "termination-unconfirmed";
        forcedCode ??= 125;
      }
      for (const [name, handler] of handlers) process.off(name, handler);
      const output = Buffer.concat(chunks).toString("utf8");
      let value, serialized;
      try {
        value = parseReceipt(output);
        serialized = JSON.stringify(value);
      } catch {
        /* Never echo parser input. */
        value = undefined;
      }
      const exitCode =
        forcedCode ??
        (code === null ? 128 + (constants.signals[name] ?? 1) : code);
      if (failure || exitCode !== 0)
        resolve({
          exitCode: exitCode || 1,
          diagnostic: {
            reason: failure ?? "child-exit",
            ...deploymentJsonDiagnostic(value),
          },
        });
      else if (value?.success !== true)
        resolve({
          exitCode: 1,
          diagnostic: {
            reason:
              value?.success === false ? "reported-failure" : "invalid-json",
            ...deploymentJsonDiagnostic(value),
          },
        });
      else if (/apiKey|uploadTicket|jobTicket|lrk_/i.test(serialized))
        resolve({ exitCode: 1, diagnostic: { reason: "sensitive-output" } });
      else resolve({ exitCode: 0, output });
    };
    child.on("close", (code, name) => {
      void finish(code, name);
    });
  });
}

if (isMainModule(import.meta.url)) {
  const [step, output, command, ...args] = process.argv.slice(2);
  if (
    !["client-install", "client-doctor", "client-uninstall"].includes(step) ||
    !output ||
    !command
  )
    throw new Error("Invalid deployment JSON check request");
  try {
    const result = await runDeploymentJsonCheck(command, args);
    if (result.exitCode !== 0) {
      console.error(
        `Deployment JSON check failed: ${JSON.stringify({ step, exit: result.exitCode, ...result.diagnostic })}`,
      );
      process.exitCode = result.exitCode;
    } else {
      // Exclusive creation rejects stale files and symlinks; no raw failure
      // payload is persisted. The caller removes this private success receipt.
      const file = await open(output, "wx", 0o600);
      try {
        await file.writeFile(result.output);
      } finally {
        await file.close();
      }
    }
  } catch (error) {
    console.error(
      `Deployment JSON check failed: ${JSON.stringify({ step, reason: "receipt-or-runner-failed", ...deploymentJsonDiagnostic({ error: { diagnostic: { systemCode: error.code } } }) })}`,
    );
    process.exitCode = 1;
  }
}
