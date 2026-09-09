import { lstat, readdir, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { boundedIntegerEnvironment } from "./environment.mjs";

export function updateLogPolicy(environment, maxOperationBytes) {
  const maxBytes = boundedIntegerEnvironment(
    environment,
    "UPDATE_LOG_TOTAL_MAX_BYTES",
    40 * 1024 * 1024,
    64 * 1024,
    1024 * 1024 * 1024,
  );
  if (maxOperationBytes > maxBytes)
    throw new Error(
      "UPDATE_MAX_OPERATION_LOG_BYTES must not exceed UPDATE_LOG_TOTAL_MAX_BYTES",
    );
  return {
    maxBytes,
    reserveBytes: maxOperationBytes,
    retentionMs:
      boundedIntegerEnvironment(
        environment,
        "UPDATE_LOG_RETENTION_DAYS",
        7,
        1,
        365,
      ) * 86400000,
    intervalMs: 15 * 60 * 1000,
  };
}

// Called only by the single controller, serialized across startup/interval/jobs.
// History JSON is deliberately not removed: expiring diagnostics must not erase
// the success/failure record or break the existing operation API.
export async function collectUpdateLogs({
  root,
  policy,
  activeId,
  now = Date.now(),
}) {
  const directory = await lstat(root);
  if (!directory.isDirectory() || (await realpath(root)) !== resolve(root))
    throw new Error("Unsafe update log directory");
  const logs = [];
  for (const name of await readdir(root)) {
    const match = /^(updop_[0-9]+_[a-z0-9]+)\.log$/.exec(name);
    if (!match) continue;
    const path = join(root, name);
    let info;
    try {
      info = await lstat(path);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    // Never follow links, cross devices or delete an unexpected special entry.
    if (!info.isFile() || info.nlink !== 1 || info.dev !== directory.dev)
      throw new Error("Unsafe update log entry");
    logs.push({ id: match[1], path, info });
  }
  logs.sort(
    (a, b) => a.info.mtimeMs - b.info.mtimeMs || a.id.localeCompare(b.id),
  );
  // Keep room for the active (or next) capped log, so growth between periodic
  // collections cannot exceed the total budget in normal single-job operation.
  let inactiveBytes = logs
    .filter((log) => log.id !== activeId())
    .reduce((sum, log) => sum + log.info.size, 0);
  let deleted = 0;
  for (const log of logs) {
    if (log.id === activeId()) continue;
    if (
      now - log.info.mtimeMs < policy.retentionMs &&
      inactiveBytes <= policy.maxBytes - policy.reserveBytes
    )
      continue;
    try {
      const current = await lstat(log.path);
      if (log.id === activeId()) continue;
      if (
        !current.isFile() ||
        current.nlink !== 1 ||
        current.dev !== log.info.dev ||
        current.ino !== log.info.ino ||
        current.mtimeMs !== log.info.mtimeMs ||
        current.size !== log.info.size
      )
        throw new Error("Update log changed during collection");
      await unlink(log.path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    inactiveBytes -= log.info.size;
    deleted++;
  }
  return { deleted };
}
