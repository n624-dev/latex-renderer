import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Socket } from "node:net";
import { afterEach, expect, it, vi } from "vitest";
import {
  controllerIdle,
  readControllerState,
} from "../deploy/scripts/updater-activation.mjs";
import { prepareUpdaterTransport } from "../deploy/scripts/updater-transport.mjs";
import { acquireMutationLockForPath } from "../deploy/scripts/mutation-lock.mjs";
import {
  activationBarrierControllerSource,
  waitForControllerState,
} from "../deploy/ci/updater-activation-barrier.mjs";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "updater-cutover-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  return root;
}
async function listener(
  handle: (req: IncomingMessage, res: ServerResponse) => void,
) {
  const root = await directory(),
    token = randomBytes(32).toString("hex");
  const tokenFile = join(root, "token"),
    socketPath = join(root, "controller.sock");
  await writeFile(tokenFile, token, { mode: 0o600 });
  const paths: string[] = [],
    sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401);
      res.end();
      return;
    }
    handle(req, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  cleanups.push(
    () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  return { tokenFile, socketPath, paths };
}
const idle = { activeOperationId: null, lastError: null };
it("waits for the installed controller's listener rather than treating process startup as API readiness", async () => {
  const unavailable = Object.assign(new Error("listener not ready"), {
    code: "UPDATER_CONTROLLER_UNAVAILABLE",
  });
  const read = vi
    .fn()
    .mockRejectedValueOnce(unavailable)
    .mockRejectedValueOnce(unavailable)
    .mockResolvedValue(idle);
  let clock = 0;
  const wait = () => {
    clock += 250;
    return Promise.resolve();
  };
  expect(
    await waitForControllerState(read, {
      now: () => clock,
      wait,
      timeoutMs: 1000,
    }),
  ).toEqual(idle);
  expect(read).toHaveBeenCalledTimes(3);
  read.mockRejectedValue(unavailable);
  clock = 0;
  read.mockClear();
  await expect(
    waitForControllerState(read, { now: () => clock, wait, timeoutMs: 1000 }),
  ).rejects.toThrow("probe deadline");
  expect(read).toHaveBeenCalledTimes(4);
});
it.each(["invalid JSON", "authentication rejected"])(
  "does not turn %s into a readiness retry",
  async (message) => {
    const read = vi.fn().mockRejectedValue(new Error(message));
    await expect(waitForControllerState(read)).rejects.toThrow(message);
    expect(read).toHaveBeenCalledOnce();
  },
);
it("reads the authenticated lightweight completion barrier over a real Unix socket", async () => {
  const f = await listener((_req, res) => res.end(JSON.stringify(idle)));
  expect(await readControllerState(f)).toEqual(idle);
  expect(f.paths).toEqual(["/v1/activation-state"]);
});
it("falls back only for a historical controller without the lightweight endpoint", async () => {
  const f = await listener((req, res) => {
    if (req.url === "/v1/activation-state") {
      res.writeHead(404);
      res.end();
    } else
      res.end(
        JSON.stringify({ ...idle, installed: { version: "historical" } }),
      );
  });
  expect(controllerIdle(await readControllerState(f))).toBe(true);
  expect(f.paths).toEqual(["/v1/activation-state", "/v1/state"]);
});
it.each([401, 403, 500])(
  "does not fall back or retry a rejected state response: %i",
  async (status) => {
    const f = await listener((_req, res) => {
      res.writeHead(status);
      res.end();
    });
    await expect(readControllerState(f)).rejects.toMatchObject({
      statusCode: status,
    });
    expect(f.paths).toEqual(["/v1/activation-state"]);
  },
);
it.each([502, 503, 504])(
  "classifies a transient unavailable response without switching APIs: %i",
  async (status) => {
    const f = await listener((_req, res) => {
      res.writeHead(status);
      res.end();
    });
    await expect(readControllerState(f)).rejects.toMatchObject({
      code: "UPDATER_CONTROLLER_UNAVAILABLE",
    });
    expect(f.paths).toEqual(["/v1/activation-state"]);
  },
);
it("bounds a stalled or continuously dripping response with an absolute deadline", async () => {
  const f = await listener((_req, res) => {
    const interval = setInterval(() => res.write(" "), 5);
    res.once("close", () => clearInterval(interval));
  });
  await expect(
    readControllerState({ ...f, timeoutMs: 40 }),
  ).rejects.toMatchObject({ code: "UPDATER_CONTROLLER_UNAVAILABLE" });
});
it("rejects invalid JSON and oversized state instead of assuming idle", async () => {
  for (const body of ["{", "x".repeat(1024 * 1024 + 1)]) {
    const f = await listener((_req, res) => res.end(body));
    await expect(readControllerState(f)).rejects.toThrow();
    expect(f.paths).toEqual(["/v1/activation-state"]);
  }
});
it("keeps missing credentials fatal while allowing a missing listener to be retried", async () => {
  const root = await directory(),
    tokenFile = join(root, "token"),
    socketPath = join(root, "missing.sock");
  await expect(
    readControllerState({ tokenFile, socketPath }),
  ).rejects.toMatchObject({ code: "ENOENT" });
  await writeFile(tokenFile, "fixture-token");
  await expect(
    readControllerState({ tokenFile, socketPath }),
  ).rejects.toMatchObject({ code: "UPDATER_CONTROLLER_UNAVAILABLE" });
});
it("retries a connection reset while reading a state response", async () => {
  const f = await listener((_req, res) => {
    res.writeHead(200);
    res.flushHeaders();
    res.write("{");
    setImmediate(() => res.destroy());
  });
  await expect(readControllerState(f)).rejects.toMatchObject({
    code: "UPDATER_CONTROLLER_UNAVAILABLE",
  });
});
async function transport() {
  const root = await directory();
  await mkdir(join(root, "deploy/scripts"), { recursive: true });
  await writeFile(
    join(root, "deploy/scripts/updater-socket-v1.mjs"),
    "export const updaterSocketProtocol = 1;",
  );
  const path = join(root, "mutation.lock");
  return {
    slots: {
      state: () => Promise.resolve({ current: "verified" }),
      verify: () => Promise.resolve({ root }),
    },
    action: "resume" as const,
    compact: true,
    run: vi.fn(),
    lockPath: path,
    acquireLock: () => acquireMutationLockForPath(path),
    isControllerActive: () => true,
    canStopController: () => Promise.resolve(true),
  };
}
it("keeps a busy controller untouched even from activation's ExecStopPost", async () => {
  const f = await transport();
  f.canStopController = () => Promise.resolve(false);
  expect(await prepareUpdaterTransport(f)).toEqual({
    activated: true,
    deferred: true,
  });
  expect(f.run).not.toHaveBeenCalled();
  const lock = await f.acquireLock();
  await lock.release();
});
it("holds the real shared lock from the completion check through transport resume", async () => {
  const f = await transport();
  const blocked = async () =>
    expect(f.acquireLock()).rejects.toMatchObject({
      code: "MUTATION_LOCK_BUSY",
    });
  f.canStopController = async () => {
    await blocked();
    return true;
  };
  f.run.mockImplementation(() => {
    expect(
      spawnSync("/usr/bin/flock", ["-n", f.lockPath, "/usr/bin/true"]).status,
    ).toBe(1);
  });
  expect(await prepareUpdaterTransport(f)).toEqual({ activated: true });
  expect(f.run.mock.calls.at(-1)).toEqual([
    "start",
    "--no-block",
    "latex-renderer-update-manager.socket",
  ]);
  const lock = await f.acquireLock();
  await lock.release();
});
it.each(["corrupt state", "authentication failed", "request timed out"])(
  "does not stop management when cleanup cannot confirm idle: %s",
  async (reason) => {
    const f = await transport();
    f.canStopController = () => Promise.reject(new Error(reason));
    await expect(prepareUpdaterTransport(f)).rejects.toThrow(reason);
    expect(f.run).not.toHaveBeenCalled();
    const lock = await f.acquireLock();
    await lock.release();
  },
);
it("does not resume without the shared lock and can restore an already stopped controller", async () => {
  const f = await transport();
  await expect(
    prepareUpdaterTransport({ slots: f.slots, action: "resume", run: f.run }),
  ).rejects.toThrow("commit barrier");
  expect(f.run).not.toHaveBeenCalled();
  const lock = await f.acquireLock();
  await expect(prepareUpdaterTransport(f)).rejects.toMatchObject({
    code: "MUTATION_LOCK_BUSY",
  });
  expect(f.run).not.toHaveBeenCalled();
  await lock.release();
  f.isControllerActive = () => false;
  f.canStopController = () =>
    Promise.reject(new Error("stopped controller should not be queried"));
  expect(await prepareUpdaterTransport(f)).toEqual({ activated: true });
});
it("restores plain transport after an independent rollback to a historical slot", async () => {
  const f = await transport();
  await rm(join(dirname(f.lockPath), "deploy/scripts/updater-socket-v1.mjs"));
  f.isControllerActive = () => false;
  expect(await prepareUpdaterTransport(f)).toEqual({ activated: false });
  expect(f.run.mock.calls).toEqual([
    ["stop", "latex-renderer-update-manager.service"],
    ["disable", "--now", "latex-renderer-update-manager.socket"],
    ["enable", "latex-renderer-update-manager.service"],
    ["start", "latex-renderer-update-manager.service"],
  ]);
});
it("executes the real generated CI controller through timeout, invalid state and commit", async () => {
  const root = await directory(),
    socket = join(root, "fixture.sock"),
    tokenFile = join(root, "token"),
    committed = join(root, "committed"),
    invalid = join(root, "invalid"),
    timedOut = join(root, "timed-out"),
    script = join(root, "controller.mjs");
  await writeFile(tokenFile, randomBytes(32).toString("hex"), { mode: 0o600 });
  await writeFile(
    script,
    activationBarrierControllerSource({ socket, committed, invalid, timedOut }),
  );
  const child = spawn(process.execPath, ["--max-old-space-size=32", script], {
    env: { PATH: process.env.PATH, UPDATE_MANAGER_TOKEN_FILE: tokenFile },
    stdio: "ignore",
  });
  const closed = new Promise<void>((resolve) =>
    child.once("close", () => resolve()),
  );
  child.once("error", () => {});
  cleanups.push(async () => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
    await closed;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await lstat(socket).then(
        () => true,
        () => false,
      )
    )
      break;
    await delay(20);
  }
  await lstat(socket);
  const options = { socketPath: socket, tokenFile, timeoutMs: 300 };
  await expect(readControllerState(options)).rejects.toMatchObject({
    code: "UPDATER_CONTROLLER_UNAVAILABLE",
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await lstat(timedOut).then(
        () => true,
        () => false,
      )
    )
      break;
    await delay(10);
  }
  expect(await readFile(timedOut, "utf8")).toBe("timed-out");
  expect(controllerIdle(await readControllerState(options))).toBe(false);
  await writeFile(invalid, "invalid");
  await expect(readControllerState(options)).rejects.toThrow();
  await rm(invalid);
  await writeFile(committed, "committed");
  expect(controllerIdle(await readControllerState(options))).toBe(true);
  expect(child.exitCode).toBeNull();
});
