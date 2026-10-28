import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  activateAfterOperation,
  controllerIdle,
} from "../deploy/scripts/updater-activation.mjs";
import { acquireMutationLockForPath } from "../deploy/scripts/mutation-lock.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
function fixture() {
  let clock = 0;
  const release = vi.fn().mockResolvedValue(undefined);
  return {
    release,
    acquireLock: vi.fn().mockResolvedValue({ release }),
    hasCandidate: vi.fn().mockResolvedValue(true),
    verifyCandidate: vi.fn().mockResolvedValue(undefined),
    readController: vi
      .fn()
      .mockResolvedValue({ activeOperationId: null, lastError: null }),
    stopController: vi.fn().mockResolvedValue(undefined),
    startController: vi.fn().mockResolvedValue(undefined),
    activate: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn(() => {
      clock += 1000;
      return Promise.resolve();
    }),
    now: () => clock,
    timeoutMs: 60_000,
  };
}
it("waits beyond the old 10-second timer after helper unlock, without stopping the controller", async () => {
  const f = fixture();
  f.readController.mockImplementation(() =>
    Promise.resolve({
      activeOperationId: f.now() < 20_000 ? "updop_running" : null,
      lastError: null,
    }),
  );
  const tick = f.wait.getMockImplementation();
  f.wait.mockImplementation(() => {
    expect(f.stopController).not.toHaveBeenCalled();
    if (!tick) throw new Error("Missing clock fixture");
    return tick();
  });
  expect(await activateAfterOperation(f)).toBe(true);
  expect(f.readController).toHaveBeenCalledTimes(21);
  expect(f.verifyCandidate).toHaveBeenCalledOnce();
  expect(f.release).toHaveBeenCalledTimes(21);
  expect(f.stopController).toHaveBeenCalledOnce();
  expect(f.activate).toHaveBeenCalledOnce();
  expect(f.startController).toHaveBeenCalledOnce();
});
it("keeps the real shared lock from idle check through controller stop, then lets bootstrap acquire it", async () => {
  const root = await mkdtemp(join(tmpdir(), "updater-activation-"));
  roots.push(root);
  const path = join(root, "mutation.lock"),
    f = fixture();
  const acquire = () => acquireMutationLockForPath(path);
  await activateAfterOperation({
    ...f,
    acquireLock: acquire,
    readController: async () => {
      await expect(acquire()).rejects.toMatchObject({
        code: "MUTATION_LOCK_BUSY",
      });
      return { activeOperationId: null, lastError: null };
    },
    stopController: async () => {
      await expect(acquire()).rejects.toMatchObject({
        code: "MUTATION_LOCK_BUSY",
      });
    },
    activate: async () => {
      const lock = await acquire();
      await lock.release();
    },
  });
});
it("waits for another host mutation without inspecting or stopping its controller", async () => {
  const f = fixture();
  f.acquireLock.mockRejectedValueOnce(
    Object.assign(new Error("busy"), { code: "MUTATION_LOCK_BUSY" }),
  );
  expect(await activateAfterOperation(f)).toBe(true);
  expect(f.wait).toHaveBeenCalledOnce();
  expect(f.readController).toHaveBeenCalledOnce();
});
it("leaves a running operation untouched when the bounded wait expires", async () => {
  const f = fixture();
  f.timeoutMs = 2000;
  f.readController.mockResolvedValue({
    activeOperationId: "updop_still_running",
    lastError: null,
  });
  await expect(activateAfterOperation(f)).rejects.toThrow("Timed out");
  expect(f.stopController).not.toHaveBeenCalled();
  expect(f.activate).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledTimes(2);
});
it.each([
  "readController",
  "hasCandidate",
  "verifyCandidate",
  "acquireLock",
] as const)("fails closed when %s fails", async (field) => {
  const f = fixture();
  f[field].mockRejectedValue(new Error("corrupt or unavailable"));
  await expect(activateAfterOperation(f)).rejects.toThrow(
    "corrupt or unavailable",
  );
  expect(f.stopController).not.toHaveBeenCalled();
  expect(f.activate).not.toHaveBeenCalled();
});
it.each(["stopController", "activate"] as const)(
  "restores management after %s fails",
  async (field) => {
    const f = fixture();
    f[field].mockRejectedValue(new Error("failed"));
    await expect(activateAfterOperation(f)).rejects.toThrow("failed");
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.startController).toHaveBeenCalledOnce();
  },
);
it("does not restart a controller when there is no nominated candidate", async () => {
  const f = fixture();
  f.hasCandidate.mockResolvedValue(false);
  expect(await activateAfterOperation(f)).toBe(false);
  expect(f.readController).not.toHaveBeenCalled();
  expect(f.stopController).not.toHaveBeenCalled();
  expect(f.activate).not.toHaveBeenCalled();
  expect(f.release).toHaveBeenCalledOnce();
});
it.each([
  null,
  {},
  { activeOperationId: null },
  { activeOperationId: 123, lastError: null },
  { activeOperationId: null, lastError: {} },
])("rejects invalid controller state %j", (state) => {
  expect(() => controllerIdle(state)).toThrow("Invalid controller");
});
it("preserves failed history, rather than clearing it to activate a candidate", async () => {
  const f = fixture();
  f.readController.mockResolvedValue({
    activeOperationId: null,
    lastError: "application failed",
  });
  await expect(activateAfterOperation(f)).rejects.toThrow(
    "Resolve the failed application",
  );
  expect(f.stopController).not.toHaveBeenCalled();
  expect(f.activate).not.toHaveBeenCalled();
});
