import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireMutationLockForPath } from "../deploy/scripts/mutation-lock.mjs";

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
});
