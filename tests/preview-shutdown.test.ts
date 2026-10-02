import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { stopPreview } from "../apps/public-web/stop-preview.mjs";

async function worker(ignoreTerm: boolean) {
  const child = spawn(
    process.execPath,
    [
      "--eval",
      `
    process.on('SIGTERM', () => ${ignoreTerm ? "{}" : "process.exit(0)"});
    process.stdout.write('ready');
    setInterval(() => {}, 1000);
  `,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const exited = once(child, "exit");
  await once(child.stdout, "data");
  return { child, exited };
}

describe.skipIf(process.platform === "win32")(
  "POSIX local preview shutdown",
  () => {
    it("waits for graceful termination", async () => {
      const { child, exited } = await worker(false);
      try {
        await stopPreview(child, exited);
        expect(child.exitCode).toBe(0);
      } finally {
        child.kill("SIGKILL");
      }
    });
    it("kills and reaps a preview which ignores graceful termination", async () => {
      const { child, exited } = await worker(true);
      try {
        await stopPreview(child, exited, 30);
        expect(child.signalCode).toBe("SIGKILL");
      } finally {
        child.kill("SIGKILL");
      }
    });
    it("accepts an already exited preview", async () => {
      const { child, exited } = await worker(false);
      child.kill("SIGTERM");
      await exited;
      await stopPreview(child, exited);
      expect(child.exitCode).toBe(0);
    });
    it("does not leave a five-second losing timer keeping the process alive", () => {
      const url = new URL(
        "../apps/public-web/stop-preview.mjs",
        import.meta.url,
      ).href;
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "--eval",
          `
      import { stopPreview } from ${JSON.stringify(url)};
      await stopPreview({ exitCode: 0, signalCode: null, kill() { throw new Error('already exited'); } }, Promise.resolve(0));
    `,
        ],
        { encoding: "utf8", timeout: 2_000 },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    });
  },
);
