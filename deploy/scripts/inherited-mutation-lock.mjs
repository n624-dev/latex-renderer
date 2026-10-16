import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage();
// Kept separate from the frozen bootstrap-v1 mutation-lock implementation.
// flock operates on the shared open file description: close, never LOCK_UN,
// so descendants still holding fd 3 retain protection after parent death.
export async function acquireInheritedMutationLockForPath(path) {
  const handle = await open(
    path,
    constants.O_RDWR |
      constants.O_CREAT |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o660,
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.mode & 0o002)
      throw new Error("Invalid mutation lock inode");
    await new Promise((resolve, reject) => {
      const child = spawn(
        "/usr/bin/flock",
        ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "3"],
        { stdio: ["ignore", "ignore", "ignore", handle.fd] },
      );
      child.once("error", reject);
      child.once("close", (code) => {
        if (code === 0) return resolve();
        const error = new Error(
          code === 75
            ? "Another application or TeX environment mutation is already running"
            : "Cannot acquire inherited mutation lock",
        );
        if (code === 75) error.code = "MUTATION_LOCK_BUSY";
        reject(error);
      });
    });
    let closed = false;
    return {
      fd: handle.fd,
      async release() {
        if (!closed) {
          closed = true;
          await handle.close();
        }
      },
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export function acquireInheritedMutationLock() {
  return acquireInheritedMutationLockForPath(
    "/run/latex-renderer/mutation.lock",
  );
}
export function withInheritedMutationLock(lock, action) {
  return context.run(lock?.fd, action);
}
export function inheritedMutationStdio(streams) {
  const fd = context.getStore();
  return fd === undefined ? streams : [...streams, fd];
}
