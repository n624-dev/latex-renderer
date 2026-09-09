import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

export async function prepareApplicationDatabase(
  path,
  { uid, gid, createOnly = false },
) {
  if (![uid, gid].every((id) => Number.isSafeInteger(id) && id >= 0))
    throw new Error("Invalid database identity");
  const parent = dirname(resolve(path));
  if (
    (await realpath(parent)) !== parent ||
    !(await lstat(parent)).isDirectory()
  )
    throw new Error("Database parent must be a real directory");
  let missing = false;
  try {
    await lstat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    missing = true;
  }
  if (missing || createOnly) {
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      try {
        await lstat(`${path}${suffix}`);
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      throw new Error("Refusing new database with existing SQLite sidecars");
    }
  }
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    const target = `${path}${suffix}`;
    let file;
    if (suffix === "") {
      try {
        file = await open(
          target,
          constants.O_RDWR |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o660,
        );
      } catch (error) {
        if (error.code !== "EEXIST" || createOnly) throw error;
      }
    }
    if (!file) {
      try {
        file = await open(
          target,
          constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
      } catch (error) {
        if (suffix && error.code === "ENOENT") continue;
        throw error;
      }
    }
    try {
      const info = await file.stat();
      if (!info.isFile() || info.nlink !== 1)
        throw new Error("Database entries must be regular single-link files");
      // SQLite defaults to 0644 before umask; umask alone cannot grant group
      // write. Set the main file before SQLite derives WAL/SHM permissions.
      if (info.uid !== uid || info.gid !== gid) await file.chown(uid, gid);
      await file.chmod(0o660);
      await file.sync();
    } finally {
      await file.close();
    }
  }
}

export function applicationDatabaseIdentity() {
  const id = (option) =>
    Number(
      execFileSync("/usr/bin/id", [option, "latex-renderer"], {
        encoding: "utf8",
      }).trim(),
    );
  return { uid: id("-u"), gid: id("-g") };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.getuid() !== 0 || process.argv.length !== 2)
    throw new Error("Database preparation requires root without arguments");
  await prepareApplicationDatabase(
    "/var/lib/latex-renderer/renderer.sqlite3",
    applicationDatabaseIdentity(),
  );
}
