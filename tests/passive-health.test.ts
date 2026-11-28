import { chmodSync, mkdtempSync, rmSync, symlinkSync, linkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
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
      path = join(directory, "state.json"),
      databasePath = join(directory, "state.sqlite3");
    const db = new DatabaseSync(databasePath);
    const now = Date.now();
    const run =
      (pid = process.pid, active = "active") =>
      () => `Id=latex-renderer-worker.service
LoadState=loaded
ActiveState=${active}
MainPID=${pid}
Result=success

Id=latex-renderer-worker.socket
ActiveState=active
SubState=listening`;
    const options = { path, now, databasePath, run: run() };
    const write = (mode = "running", stopping = false, at = now) =>
      writeWorkerHealth(path, {
        at: new Date(at).toISOString(),
        mode,
        stopping,
      });
    try {
      db.exec("CREATE TABLE system_settings(key TEXT, value_json TEXT)");
      write();
      expect(readWorkerHealth(options).operational).toBe(true);
      expect(
        readWorkerHealth({ ...options, now: now + 31_000 }).operational,
      ).toBe(false);
      expect(
        readWorkerHealth({
          ...options,
          run: run(999999),
        }).operational,
      ).toBe(false);
      expect(
        readWorkerHealth({
          ...options,
          run: run(process.pid, "activating"),
        }).operational,
      ).toBe(false);
      write("paused");
      expect(readWorkerHealth(options).operational).toBe(true);
      write("running", true);
      expect(readWorkerHealth(options).operational).toBe(false);
      write();
      linkSync(path, join(directory, "second-link"));
      expect(readWorkerHealth(options).operational).toBe(false);
      rmSync(join(directory, "second-link"));
      const alias = join(directory, "alias.json");
      symlinkSync(path, alias);
      expect(readWorkerHealth({ ...options, path: alias }).operational).toBe(
        false,
      );
      chmodSync(directory, 0o770);
      expect(readWorkerHealth(options).operational).toBe(false);
    } finally {
      db.close();
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
