import { chmodSync, mkdtempSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it, vi } from "vitest";
import {
  readWorkerHealth,
  writeWorkerHealth,
} from "../deploy/scripts/worker-health.mjs";
import { createStatusProbe } from "../apps/admin-web/src/status-probe.js";
import type { ClientDistribution } from "../apps/admin-web/src/client-distribution.js";

it.skipIf(process.platform === "win32")(
  "keeps passive worker health bounded, fresh and bound to the running PID",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "worker-health-")),
      path = join(directory, "state.json");
    const now = Date.now(),
      run = () => `ActiveState=active\nMainPID=${process.pid}\n`;
    const write = (mode = "running", stopping = false, at = now) =>
      writeWorkerHealth(path, {
        at: new Date(at).toISOString(),
        mode,
        stopping,
      });
    try {
      write();
      expect(readWorkerHealth({ path, now, run }).operational).toBe(true);
      expect(
        readWorkerHealth({ path, now: now + 31_000, run }).operational,
      ).toBe(false);
      expect(
        readWorkerHealth({
          path,
          now,
          run: () => "ActiveState=active\nMainPID=999999\n",
        }).operational,
      ).toBe(false);
      expect(
        readWorkerHealth({
          path,
          now,
          run: () => `ActiveState=inactive\nMainPID=${process.pid}\n`,
        }).operational,
      ).toBe(false);
      write("paused");
      expect(readWorkerHealth({ path, now, run }).operational).toBe(false);
      write("running", true);
      expect(readWorkerHealth({ path, now, run }).operational).toBe(false);
      write();
      linkSync(path, join(directory, "second-link"));
      expect(readWorkerHealth({ path, now, run }).operational).toBe(false);
      rmSync(join(directory, "second-link"));
      const alias = join(directory, "alias.json");
      symlinkSync(path, alias);
      expect(readWorkerHealth({ path: alias, now, run }).operational).toBe(
        false,
      );
      chmodSync(directory, 0o770);
      expect(readWorkerHealth({ path, now, run }).operational).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

it("does not wake sleeping APIs to render the public status page", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const distribution = {
    archive: new Uint8Array([1]),
    manifest: new Uint8Array([1]),
    installer: new Uint8Array([1]),
  } as ClientDistribution;
  try {
    const probe = createStatusProbe(
      {
        port: 3101,
        publicOrigin: "https://latex.example.com",
        clientDistRoot: "/unused",
        renderingHealthUrl: "http://127.0.0.1:3102/health/rendering",
        statusProbeTimeoutMs: 100,
      },
      distribution,
      {
        services: () => ({
          managed: true,
          services: ["api", "admin-api"].map((name) => ({
            service: `latex-renderer-${name}.service`,
            state: "idle",
            operational: true,
            managed: true,
            active: true,
          })),
        }),
        worker: () => ({ operational: true, state: "running" }),
      },
    );
    expect(await probe()).toMatchObject({
      api: true,
      apiIdle: true,
      rendering: true,
    });
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});
