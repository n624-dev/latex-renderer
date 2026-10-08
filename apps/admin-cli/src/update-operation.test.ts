import { expect, it, vi } from "vitest";
import {
  pollUpdateOperation,
  UpdateOperationUnconfirmedError,
  UPDATE_RECONNECT_MAX_MS,
  UPDATE_WAIT_MAX_MS,
} from "./update-operation.js";

const id = "updop_1791456776170_fixture";
function fixture() {
  let now = 0;
  return {
    read: vi.fn<(id: string) => Promise<unknown>>(),
    sleep: vi.fn((ms: number) => {
      now += ms;
      return Promise.resolve();
    }),
    now: () => now,
    onStatus: vi.fn<(status: string) => void>(),
    onOperation: vi.fn<(id: string) => void>(),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

it("preserves the ID and resumes after a four-minute service restart", async () => {
  const f = fixture();
  f.read.mockImplementation(() => {
    if (f.now() === 0) return Promise.resolve({ id, status: "running" });
    if (f.now() < 4 * 60_000)
      return Promise.reject(new Error("synthetic private transport error"));
    return Promise.resolve({ id, status: "succeeded" });
  });
  expect(await pollUpdateOperation({ id }, f)).toEqual({
    id,
    status: "succeeded",
  });
  expect(f.onOperation).toHaveBeenCalledExactlyOnceWith(id);
  expect(f.read.mock.calls.every(([requested]) => requested === id)).toBe(true);
  expect(f.onStatus.mock.calls).toEqual([
    ["running"],
    ["reconnecting to Admin API..."],
    ["succeeded"],
  ]);
});

it("only the server's terminal failed state is an actual failed operation", async () => {
  const f = fixture(),
    failed = { id, status: "failed", error: "deployment failed" };
  f.read.mockResolvedValue(failed);
  expect(await pollUpdateOperation({ id }, f)).toBe(failed);
  expect(f.sleep).not.toHaveBeenCalled();
});

it("a ten-minute transport outage is unconfirmed and retains the resume command", async () => {
  const f = fixture();
  f.read.mockRejectedValue(new Error("secret transport detail"));
  const result = pollUpdateOperation({ id }, f);
  await expect(result).rejects.toMatchObject({ operationId: id });
  await expect(result).rejects.toThrow(`update operation ${id}`);
  expect(f.now()).toBe(UPDATE_RECONNECT_MAX_MS);
  expect(f.onStatus.mock.calls).toEqual([["reconnecting to Admin API..."]]);
});

it("the absolute deadline bounds a forever-running operation", async () => {
  const f = fixture();
  f.read.mockResolvedValue({ id, status: "running" });
  await expect(pollUpdateOperation({ id }, f)).rejects.toBeInstanceOf(
    UpdateOperationUnconfirmedError,
  );
  expect(f.now()).toBe(UPDATE_WAIT_MAX_MS);
  expect(f.onStatus.mock.calls).toEqual([["running"]]);
});

it("successful contacts reset only the reconnect budget, not the absolute deadline", async () => {
  const f = fixture();
  f.read.mockImplementation(() => {
    if (f.now() % (5 * 60_000) === 0)
      return Promise.resolve({ id, status: "running" });
    return Promise.reject(new Error("disconnected"));
  });
  await expect(pollUpdateOperation({ id }, f)).rejects.toBeInstanceOf(
    UpdateOperationUnconfirmedError,
  );
  expect(f.now()).toBe(UPDATE_WAIT_MAX_MS);
});

it("does not expose private request errors or falsely report failed", async () => {
  const f = fixture();
  f.read.mockRejectedValue(new Error("synthetic-private-token"));
  let caught: unknown;
  try {
    await pollUpdateOperation({ id }, f);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(UpdateOperationUnconfirmedError);
  expect((caught as Error).message).not.toContain("synthetic-private-token");
  expect(f.onStatus).not.toHaveBeenCalledWith("failed");
});

it("returns non-operation replies and rejects unsafe operation IDs without requests", async () => {
  const f = fixture(),
    reply = { unchanged: true };
  expect(await pollUpdateOperation(reply, f)).toBe(reply);
  await expect(
    pollUpdateOperation({ id: "unsafe\napply again" }, f),
  ).rejects.toThrow("Invalid update operation ID");
  expect(f.read).not.toHaveBeenCalled();
});
