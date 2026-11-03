import { afterEach, expect, it, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  runtimeMode,
  managerIdleConfiguration,
} from "../deploy/scripts/runtime-mode.mjs";
import { acquireEngineLock } from "../deploy/scripts/on-demand-engine.mjs";
import { idleContainerEngine } from "../deploy/scripts/idle-container-engine.mjs";
import { imageManagerNeedsRecovery } from "../deploy/scripts/manager-demand.mjs";
import { prepareUpdaterTransport } from "../deploy/scripts/updater-transport.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function root() {
  const value = mkdtempSync(join(tmpdir(), "compact-runtime-"));
  roots.push(value);
  return value;
}
const compact = {
  RENDERER_RUNTIME_MODE: "compact",
  WORKER_IDLE_ENABLED: "true",
};

it("keeps classic as default and rejects partially enabled compact configurations", () => {
  expect(runtimeMode({})).toBe("classic");
  expect(managerIdleConfiguration({})).toEqual({
    enabled: false,
    timeoutMs: 900000,
  });
  expect(runtimeMode(compact)).toBe("compact");
  for (const env of [
    { RENDERER_RUNTIME_MODE: "other" },
    { RENDERER_RUNTIME_MODE: "compact" },
    { ...compact, HTTP_IDLE_ENABLED: "false" },
  ])
    expect(() => runtimeMode(env)).toThrow();
});

it.skipIf(process.platform === "win32")(
  "shares the engine lock among consumers and excludes shutdown until every FD closes",
  async () => {
    const path = join(root(), "engine.lock");
    writeFileSync(path, "", { mode: 0o640 });
    const one = await acquireEngineLock({ path }),
      two = await acquireEngineLock({ path });
    try {
      await expect(
        acquireEngineLock({ path, exclusive: true }),
      ).rejects.toMatchObject({ code: "ENGINE_BUSY" });
      await one.release();
      await expect(
        acquireEngineLock({ path, exclusive: true }),
      ).rejects.toMatchObject({ code: "ENGINE_BUSY" });
    } finally {
      await two.release();
    }
    const exclusive = await acquireEngineLock({ path, exclusive: true });
    try {
      await expect(acquireEngineLock({ path })).rejects.toMatchObject({
        code: "ENGINE_BUSY",
      });
    } finally {
      await exclusive.release();
    }
    const link = `${path}.link`;
    symlinkSync(path, link);
    await expect(acquireEngineLock({ path: link })).rejects.toThrow();
  },
);

it("leaves running, queued, failed and unknown container work untouched and rechecks engine shutdown", async () => {
  const path = join(root(), "db.sqlite3"),
    db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE jobs(status TEXT,lease_owner TEXT); CREATE TABLE job_preview_requests(status TEXT,lease_owner TEXT); CREATE TABLE source_tree_readers(id TEXT); CREATE TABLE source_trees(status TEXT)",
  );
  const release = vi.fn(async () => {}),
    acquire = () => Promise.resolve({ release });
  let engineState = "active",
    containers = "",
    builds = "";
  const command = vi.fn((_cmd: string, args: string[]) => {
    if (args.includes("show")) return engineState;
    if (args.includes("history")) return builds;
    if (args.includes("ls")) return containers;
    if (args.includes("stop")) {
      engineState = "inactive";
      return "";
    }
    throw new Error("Unexpected engine operation");
  });
  const service = vi.fn(
    () => "LoadState=loaded\nActiveState=inactive\nResult=success\n",
  );
  const options = {
    environment: { ...compact, DATABASE_PATH: path },
    acquireEngine: acquire,
    acquireMutation: acquire,
    service,
    command,
  };
  try {
    service.mockReturnValueOnce(
      "LoadState=loaded\nActiveState=active\nResult=success\n",
    );
    expect(await idleContainerEngine(options)).toEqual({ state: "busy" });
    expect(command).not.toHaveBeenCalled();
    db.exec("INSERT INTO jobs VALUES ('canceled','cleanup-owner')");
    expect(await idleContainerEngine(options)).toEqual({ state: "pending" });
    expect(command).not.toHaveBeenCalled();
    db.exec("DELETE FROM jobs");
    containers = "unknown-container";
    expect(await idleContainerEngine(options)).toEqual({ state: "containers" });
    expect(command.mock.calls.some(([, args]) => args.includes("stop"))).toBe(
      false,
    );
    containers = "";
    builds = "Running";
    expect(await idleContainerEngine(options)).toEqual({ state: "builds" });
    builds = "Unknown";
    expect(await idleContainerEngine(options)).toEqual({ state: "builds" });
    builds = "Completed\nError";
    expect(await idleContainerEngine(options)).toEqual({
      state: "idle",
      stopped: true,
    });
    expect(
      command.mock.calls.filter(([, args]) => args.includes("show")),
    ).toHaveLength(5);
    engineState = "failed";
    await expect(idleContainerEngine(options)).rejects.toThrow("unavailable");
    command.mockImplementation(() => {
      throw new Error("unreachable");
    });
    await expect(idleContainerEngine(options)).rejects.toThrow("unreachable");
    expect(release).toHaveBeenCalledTimes(16);
  } finally {
    db.close();
  }
});

it("uses durable operation state for watchdog wakeups and fails closed on corruption", async () => {
  const path = root();
  mkdirSync(join(path, "operations"));
  const state = join(path, "state.json");
  writeFileSync(
    state,
    JSON.stringify({ version: 1, desired: {}, lastOperationId: null }),
    { mode: 0o640 },
  );
  expect(await imageManagerNeedsRecovery(path)).toBe(false);
  const id = "imgop_1793636243673_abc12345",
    op = join(path, "operations", `${id}.json`);
  writeFileSync(
    state,
    JSON.stringify({ version: 1, desired: {}, lastOperationId: id }),
  );
  writeFileSync(op, JSON.stringify({ id, status: "running" }), { mode: 0o640 });
  expect(await imageManagerNeedsRecovery(path)).toBe(true);
  writeFileSync(op, JSON.stringify({ id, status: "succeeded" }));
  expect(await imageManagerNeedsRecovery(path)).toBe(false);
  writeFileSync(op, "broken");
  await expect(imageManagerNeedsRecovery(path)).rejects.toThrow();
  writeFileSync(
    state,
    JSON.stringify({ version: 1, desired: {}, lastOperationId: "../escape" }),
  );
  await expect(imageManagerNeedsRecovery(path)).rejects.toThrow("identity");
});

it("keeps independent legacy Updater rollback usable and queues activation after the stop hook", async () => {
  const path = root();
  mkdirSync(join(path, "deploy/scripts"), { recursive: true });
  const slots = {
    state: () => Promise.resolve({ current: "verified-id" }),
    verify: vi.fn(() => Promise.resolve({ root: path })),
  };
  const run = vi.fn();
  await expect(
    prepareUpdaterTransport({ slots, action: "check", run }),
  ).rejects.toThrow("socket-capable");
  expect(run).not.toHaveBeenCalled();
  expect(await prepareUpdaterTransport({ slots, run })).toEqual({
    activated: false,
  });
  expect(run.mock.calls).toEqual([
    ["disable", "--now", "latex-renderer-update-manager.socket"],
    ["enable", "latex-renderer-update-manager.service"],
  ]);
  writeFileSync(
    join(path, "deploy/scripts/updater-socket-v1.mjs"),
    "export const updaterSocketProtocol = 1;",
  );
  run.mockClear();
  expect(
    await prepareUpdaterTransport({
      slots,
      action: "resume",
      compact: true,
      run,
    }),
  ).toEqual({ activated: true });
  expect(run.mock.calls.at(-1)).toEqual([
    "start",
    "--no-block",
    "latex-renderer-update-manager.socket",
  ]);
  expect(slots.verify).toHaveBeenCalledWith("verified-id");
});
