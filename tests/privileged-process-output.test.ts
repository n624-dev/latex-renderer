import { spawn } from "node:child_process";
import { describe, it, expect } from "vitest";
import { waitPrivilegedProcess } from "../deploy/scripts/privileged-process-output.mjs";

describe("independent helper output lifetime", () => {
  it.each([false, true])(
    "waits for the real process after a log sink failure (stderr=%s)",
    async (stderr) => {
      const child = spawn(
        process.execPath,
        [
          "-e",
          `process.${stderr ? "stderr" : "stdout"}.write('ready');setTimeout(()=>{process.stderr.write('finished');process.exit(7)},100)`,
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let calls = 0;
      const error = new Error("ENOSPC fixture");
      const result = await waitPrivilegedProcess(child, () => {
        calls++;
        return Promise.reject(error);
      });
      expect(calls).toBe(1);
      expect(result.code).toBe(7);
      expect(result.stderr).toContain("finished");
      expect(result.logError).toBe(error);
      expect(child.exitCode).toBe(7);
    },
  );
  it("drains bounded stderr even when both pipes exceed their OS pipe buffers", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        "process.stdout.write('a'.repeat(1048576));process.stderr.write('b'.repeat(1048576));",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const result = await waitPrivilegedProcess(child, () =>
      Promise.reject(new Error("sink unavailable")),
    );
    expect(result.code).toBe(0);
    expect(result.stderr.length).toBe(8192);
    expect(result.logError).toBeInstanceOf(Error);
  });
});
