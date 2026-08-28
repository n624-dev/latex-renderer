#!/usr/bin/env node
import { spawn } from "node:child_process";

const LOCK_PATH = "/run/latex-renderer/mutation.lock";
const READY = "latex-renderer-mutation-lock-ready\n";

export function acquireMutationLockForPath(lockPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/bin/flock",
      [
        "--exclusive",
        "--nonblock",
        "--no-fork",
        "--conflict-exit-code",
        "75",
        lockPath,
        "/bin/sh",
        "-c",
        `printf '${READY}'; exec /usr/bin/sleep infinity`,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let ready = false;
    let settled = false;
    let stdout = "";
    let stderr = "";

    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.on("error", fail);
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk).slice(0, 4096);
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (!ready && stdout === READY) {
        ready = true;
        settled = true;
        let released = false;
        resolve({
          async release() {
            if (released) return;
            released = true;
            if (child.exitCode !== null || child.signalCode !== null) return;
            await new Promise((releaseDone) => {
              child.once("close", releaseDone);
              child.kill("SIGTERM");
            });
          },
        });
      } else if (stdout.length > READY.length) {
        child.kill("SIGTERM");
        fail(
          new Error(
            "Mutation lock helper returned an invalid readiness response",
          ),
        );
      }
    });
    child.on("close", (code) => {
      if (ready || settled) return;
      const error = new Error(
        code === 75
          ? "Another application or TeX environment mutation is already running"
          : `Mutation lock helper exited ${code}: ${stderr.trim()}`,
      );
      if (code === 75) error.code = "MUTATION_LOCK_BUSY";
      fail(error);
    });
  });
}

export function acquireMutationLock() {
  return acquireMutationLockForPath(LOCK_PATH);
}
