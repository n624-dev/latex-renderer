import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { acquireMutationLockForPath } from "./mutation-lock.mjs";

const leaseName = /^lease-[a-f0-9-]{36}$/;
const sourceId = /^source_[a-f0-9]{32}$/;

async function tryLock(path) {
  try {
    return await acquireMutationLockForPath(path);
  } catch (error) {
    if (error.code === "MUTATION_LOCK_BUSY") return null;
    throw error;
  }
}

export async function protectBackupSources(directory, snapshot) {
  // Standalone backup/cleanup fixtures do not have a managed host lifecycle.
  if (!directory) return { sources: snapshot(), release: async () => {} };
  const guard = join(directory, "snapshot.lock");
  let registration;
  const deadline = Date.now() + 30_000;
  while (!(registration = await tryLock(guard))) {
    if (Date.now() >= deadline)
      throw new Error(
        "Timed out coordinating the backup snapshot with Source cleanup",
      );
    await delay(100);
  }
  try {
    const sources = snapshot();
    const ids = sources.map((source) => source.id);
    if (!ids.every((id) => sourceId.test(id)))
      throw new Error("Backup snapshot contains an invalid Source ID");
    if (ids.length === 0) return { sources, release: async () => {} };

    const path = join(directory, `lease-${randomUUID()}`);
    const handle = await open(path, "wx", 0o640);
    try {
      try {
        await handle.writeFile(JSON.stringify(ids));
        await handle.chmod(0o640);
      } finally {
        await handle.close();
      }
      const lease = await acquireMutationLockForPath(path);
      return {
        sources,
        async release() {
          await lease.release();
          await rm(path, { force: true });
        },
      };
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  } finally {
    await registration.release();
  }
}

export async function claimUnprotectedSources(directory, claim) {
  if (!directory) return claim([]);
  const registration = await tryLock(join(directory, "snapshot.lock"));
  if (!registration) return [];
  try {
    const protectedIds = new Set();
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!leaseName.test(entry.name)) continue;
      if (!entry.isFile())
        throw new Error("Unexpected backup Source lease entry");
      const path = join(directory, entry.name);
      let handle;
      try {
        handle = await open(
          path,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      try {
        const info = await handle.stat();
        if (info.nlink === 0) continue; // Completed during our open/stat window.
        if (!info.isFile() || info.nlink !== 1)
          throw new Error("Unexpected backup Source lease file");
        // Use the pinned descriptor. If a backup releases its lease after
        // readdir, flock must never recreate the unlinked path.
        const stale = await tryLock(`/proc/${process.pid}/fd/${handle.fd}`);
        if (stale) {
          await stale.release();
          await rm(path, { force: true });
          continue;
        }
        const ids = JSON.parse(await handle.readFile("utf8"));
        if (
          !Array.isArray(ids) ||
          !ids.every((id) => typeof id === "string" && sourceId.test(id))
        )
          throw new Error("Invalid active backup Source lease");
        for (const id of ids) protectedIds.add(id);
      } finally {
        await handle.close();
      }
    }
    return claim([...protectedIds]);
  } finally {
    await registration.release();
  }
}
