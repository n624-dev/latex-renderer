import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const channels = ["remote-mcp", "renderer-worker"];
const maxBytes = 2 * 1024 * 1024;
const retentionMs = 7 * 86400000;

async function checkedFile(path, device) {
  let handle;
  try {
    const st = await lstat(path);
    if (!st.isFile() || st.nlink !== 1 || st.dev !== device)
      throw new Error("Unsafe diagnostic file");
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (opened.ino !== st.ino || opened.dev !== device || opened.nlink !== 1)
      throw new Error("Diagnostic file changed");
    const head = Buffer.alloc(2048);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    let startedAt = 0;
    try {
      startedAt = Date.parse(
        JSON.parse(head.subarray(0, bytesRead).toString("utf8").split("\n")[0])
          .time,
      );
    } catch {
      /* A torn diagnostic line is not management state. */
    }
    return {
      ...st,
      startedAt: Number.isFinite(startedAt)
        ? Math.min(startedAt, st.mtimeMs)
        : 0,
    };
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  } finally {
    await handle?.close();
  }
}
async function directory(storageRoot, create = true) {
  const root = resolve(storageRoot);
  if ((await realpath(root)) !== root)
    throw new Error("Unsafe diagnostic root");
  const path = join(root, "diagnostics");
  if (create) {
    try {
      await mkdir(path, { mode: 0o770 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
  const st = await lstat(path);
  if (
    !st.isDirectory() ||
    st.isSymbolicLink() ||
    st.dev !== (await lstat(root)).dev
  )
    throw new Error("Unsafe diagnostic directory");
  return { path, device: st.dev };
}

// Two files per channel, two channels, 2 MiB per file: 8 MiB total.
// One asynchronous writer and at most 32 queued records (2 KiB each).
export function diagnosticWriter(storageRoot, channel, now = Date.now) {
  if (!channels.includes(channel))
    throw new Error("Unknown diagnostic channel");
  const queue = [];
  let flushing;
  const append = async (line) => {
    let handle;
    try {
      const bytes = Buffer.byteLength(line);
      const { path: root, device } = await directory(storageRoot);
      const path = join(root, channel + ".jsonl"),
        previous = path + ".1";
      const old = await checkedFile(previous, device);
      if (old && now() - old.startedAt >= retentionMs) await unlink(previous);
      const active = await checkedFile(path, device);
      if (active && now() - active.startedAt >= retentionMs) await unlink(path);
      else if (active && active.size + bytes > maxBytes) {
        await checkedFile(previous, device);
        await rename(path, previous);
      }
      handle = await open(
        path,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_APPEND |
          constants.O_NOFOLLOW,
        0o660,
      );
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.dev !== device ||
        opened.size + bytes > maxBytes
      )
        return;
      await handle.write(line);
    } catch {
      /* Diagnostic failure must not change authorization/job results. */
    } finally {
      try {
        await handle?.close();
      } catch {
        /* Best effort. */
      }
    }
  };
  const flush = () => {
    flushing ??= (async () => {
      while (queue.length) await append(queue.shift());
    })().finally(() => {
      flushing = undefined;
      if (queue.length) void flush();
    });
    return flushing;
  };
  const write = (record) => {
    try {
      if (queue.length >= 32) return;
      const safe = {};
      for (const key of [
        "event",
        "outcome",
        "requestId",
        "family",
        "sequence",
        "jobId",
        "exitCode",
        "result",
        "code",
        "elapsedMs",
        "state",
        "memoryPeakBytes",
        "memoryLimitBytes",
      ]) {
        const value = record[key];
        if (
          value === null ||
          typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)) ||
          (typeof value === "string" && /^[A-Za-z0-9_.:/-]{1,160}$/.test(value))
        )
          safe[key] = value;
      }
      const line =
        JSON.stringify({ ...safe, time: new Date(now()).toISOString() }) + "\n";
      if (Buffer.byteLength(line) > 2048) return;
      queue.push(line);
      void flush();
    } catch {
      /* Never stringify/log raw errors. */
    }
  };
  write.flush = flush;
  return write;
}

export async function pruneServiceDiagnostics(storageRoot, now = Date.now()) {
  let location;
  try {
    location = await directory(storageRoot, false);
  } catch (error) {
    if (error.code === "ENOENT") return 0;
    throw error;
  }
  const { path: root, device } = location;
  let deleted = 0;
  for (const channel of channels)
    for (const suffix of [".jsonl", ".jsonl.1"]) {
      const path = join(root, channel + suffix),
        info = await checkedFile(path, device);
      if (info && now - info.startedAt >= retentionMs) {
        const current = await checkedFile(path, device);
        if (
          current &&
          current.ino === info.ino &&
          now - current.startedAt >= retentionMs
        ) {
          await unlink(path);
          deleted++;
        }
      }
    }
  return deleted;
}
