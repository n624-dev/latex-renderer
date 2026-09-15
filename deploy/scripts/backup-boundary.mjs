import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

// integrity_check does not check references: both are required, including for
// old format-1 database-only archives.
export function assertBackupDatabase(database) {
  const integrity = database.prepare("PRAGMA integrity_check").all();
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
    throw new Error("SQLite integrity_check failed");
  if (database.prepare("PRAGMA foreign_key_check").get())
    throw new Error("SQLite foreign_key_check failed");
}

export function projectSourceStorageKey(source) {
  if (
    typeof source.id !== "string" ||
    !/^source_[a-f0-9]{32}$/.test(source.id) ||
    !Number.isSafeInteger(source.size) ||
    source.size < 0 ||
    typeof source.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(source.sha256)
  )
    throw new Error("Project Source metadata is invalid");
  const current = `sources/${source.id}/source.zip`;
  // Migration v3 retained the original job input and derived its Source ID
  // from exactly this job suffix. Do not allow arbitrary DB-supplied paths.
  const legacy = `jobs/job_${source.id.slice("source_".length)}/input/source.zip`;
  if (source.storage_key !== current && source.storage_key !== legacy)
    throw new Error("Project Source storage key is invalid");
  return source.storage_key;
}

// Pin each directory with an fd and open its child without following links.
// lstat/realpath followed by a pathname open alone would leave a parent-swap
// race. This host-side script requires Linux /proc/self/fd; if unavailable it
// fails closed instead of falling back to a symlink-following pathname open.
export async function openBackupFile(root, key) {
  const parts = key.split("/");
  if (
    resolve(root) !== root ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Backup file path is invalid");
  const directories = [];
  try {
    const flags =
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY;
    let directory = await open(root, flags);
    directories.push(directory);
    if ((await realpath(`/proc/self/fd/${directory.fd}`)) !== root)
      throw new Error("Backup root must not contain symbolic links");
    for (const part of parts.slice(0, -1)) {
      directory = await open(`/proc/self/fd/${directory.fd}/${part}`, flags);
      directories.push(directory);
    }
    const file = await open(
      `/proc/self/fd/${directory.fd}/${parts.at(-1)}`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1)
        throw new Error("Backup input must be a single-link regular file");
      return file;
    } catch (error) {
      await file.close();
      throw error;
    }
  } finally {
    for (const directory of directories.reverse()) await directory.close();
  }
}

export async function validateBackupArchive(path) {
  // Apply one boundary before backup publication AND before restore extraction:
  // neither side may accept an archive the other cannot safely inspect.
  const entries = (
    await archiveListing(["-tf", path, "--quoting-style=escape"])
  )
    .split("\n")
    .filter(Boolean);
  const details = (
    await archiveListing([
      "-tvf",
      path,
      "--numeric-owner",
      "--full-time",
      "--quoting-style=escape",
    ])
  )
    .split("\n")
    .filter(Boolean);
  const seen = new Set();
  if (entries.length === 0 || entries.length !== details.length)
    throw new Error("Backup archive listings are invalid");
  for (const [index, entry] of entries.entries()) {
    const directory = /^project-sources\/(?:source_[a-f0-9]{32}\/)?$/.test(
      entry,
    );
    const regular =
      /^(?:manifest\.json|renderer\.sqlite3|project-sources\/source_[a-f0-9]{32}\/source\.zip)$/.test(
        entry,
      );
    const fields = details[index].trim().split(/\s+/);
    if (
      seen.has(entry) ||
      (!directory && !regular) ||
      details[index][0] !== (directory ? "d" : "-") ||
      fields.slice(5).join(" ") !== entry ||
      !/^\d+$/.test(fields[2]) ||
      !Number.isSafeInteger(Number(fields[2]))
    )
      throw new Error("Backup archive contains an unsafe or duplicate entry");
    seen.add(entry);
  }
  if (!seen.has("renderer.sqlite3") || !seen.has("manifest.json"))
    throw new Error("Backup archive is missing its database or manifest");
}

function archiveListing(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("tar", args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      env: { ...process.env, LC_ALL: "C" },
    });
    let output = "",
      error = "",
      bytes = 0,
      exceeded = false;
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > 16 * 1024 * 1024) {
        exceeded = true;
        child.kill("SIGKILL");
      } else output += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (error.length < 8192) error += chunk.slice(0, 8192 - error.length);
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0 && !exceeded
        ? resolvePromise(output)
        : reject(
            new Error(
              exceeded
                ? "Backup archive listing exceeds its size limit"
                : `tar failed: ${error}`,
            ),
          ),
    );
  });
}
