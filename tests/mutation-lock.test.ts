import { mkdtemp, readFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireMutationLockForPath } from "../deploy/scripts/mutation-lock.mjs";

function terminateFixture(pid: number) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ESRCH"
    )
      throw error;
  }
}

describe("shared mutation lock", () => {
  let temporaryDirectory: string | undefined;

  afterEach(async () => {
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === "win32")(
    "rejects contention and permits reacquisition immediately after release",
    async () => {
      temporaryDirectory = await mkdtemp(
        join(tmpdir(), "latex-renderer-mutation-lock-"),
      );
      const lockPath = join(temporaryDirectory, "mutation.lock");
      const first = await acquireMutationLockForPath(lockPath);

      try {
        await expect(
          acquireMutationLockForPath(lockPath),
        ).rejects.toMatchObject({
          code: "MUTATION_LOCK_BUSY",
        });
      } finally {
        await first.release();
      }

      const second = await acquireMutationLockForPath(lockPath);
      await second.release();
    },
  );

  it.skipIf(process.platform !== "linux").each(["SIGKILL", "SIGTERM"] as const)(
    "releases the real lock when the owner exits with %s without finally",
    async (signal) => {
      temporaryDirectory = await mkdtemp(join(tmpdir(), "latex-lock-owner-"));
      const lockPath = join(temporaryDirectory, "mutation.lock");
      const moduleUrl = new URL(
        "../deploy/scripts/mutation-lock.mjs",
        import.meta.url,
      ).href;
      const owner = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import {acquireMutationLockForPath} from ${JSON.stringify(moduleUrl)};
         await acquireMutationLockForPath(process.argv[1]); console.log('ready');`,
          lockPath,
        ],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let helper: number | undefined;
      try {
        const [chunk] = (await once(owner.stdout, "data", {
          signal: AbortSignal.timeout(5000),
        })) as unknown[];
        expect(String(chunk).trim()).toBe("ready");
        const children = (
          await readFile(
            `/proc/${owner.pid}/task/${owner.pid}/children`,
            "utf8",
          )
        )
          .trim()
          .split(/\s+/);
        expect(children).toHaveLength(1);
        helper = Number(children[0]);
        await expect(
          acquireMutationLockForPath(lockPath),
        ).rejects.toMatchObject({ code: "MUTATION_LOCK_BUSY" });
        const exited = once(owner, "exit");
        owner.kill(signal);
        await exited;
        // EOF propagation is asynchronous; bounded polling checks availability,
        // never steals a lock and does not kill the helper to make the test pass.
        let released = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          try {
            const next = await acquireMutationLockForPath(lockPath);
            await next.release();
            released = true;
            break;
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !("code" in error) ||
              error.code !== "MUTATION_LOCK_BUSY"
            )
              throw error;
            await delay(10);
          }
        }
        expect(released).toBe(true);
      } finally {
        if (owner.exitCode === null && owner.signalCode === null)
          owner.kill("SIGKILL");
        // Cleanup the known fixture child if this test is run against the old,
        // leaking implementation. Never target a production process or lock.
        if (helper) terminateFixture(helper);
      }
    },
  );
});
