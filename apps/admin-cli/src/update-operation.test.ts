import { expect, it, vi } from "vitest";
import {
  pollUpdateOperation,
  UpdateOperationUnconfirmedError,
  UPDATE_RECONNECT_MAX_MS,
  UPDATE_WAIT_MAX_MS,
} from "./update-operation.js";

const id = "updop_1791456776170_fixture";
const completed = {
  id,
  status: "succeeded",
  outcome: { application: "succeeded", updater: "succeeded", complete: true },
};
function fixture() {
  let now = 0;
  return {
    read: vi.fn<(id: string, timeoutMs: number) => Promise<unknown>>(),
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
    return Promise.resolve(completed);
  });
  expect(await pollUpdateOperation({ id }, f)).toEqual(completed);
  expect(f.onOperation).toHaveBeenCalledExactlyOnceWith(id);
  expect(f.read.mock.calls.every(([requested]) => requested === id)).toBe(true);
  expect(f.onStatus.mock.calls).toEqual([
    ["running"],
    ["reconnecting to Admin API..."],
    ["succeeded"],
  ]);
});

it("waits for the independent Updater, including a restart after application success", async () => {
  const f = fixture();
  f.read
    .mockResolvedValueOnce({ id, status: "running" })
    .mockResolvedValueOnce({
      id,
      status: "succeeded",
      outcome: {
        application: "succeeded",
        updater: "activating",
        complete: false,
      },
    })
    .mockRejectedValueOnce(new Error("controller restarting"))
    .mockResolvedValue(completed);
  expect(await pollUpdateOperation({ id }, f)).toBe(completed);
  expect(f.onStatus.mock.calls).toEqual([
    ["running"],
    ["application succeeded; Updater activating"],
    ["reconnecting to Admin API..."],
    ["succeeded"],
  ]);
  expect(f.read.mock.calls.every(([requested]) => requested === id)).toBe(true);
});

it.each([
  "needs-attention",
  "legacy-unconfirmed",
  "historical",
  "not-confirmed",
])(
  "does not report application-only success as update success (%s)",
  async (updater) => {
    const f = fixture();
    f.read.mockResolvedValue({
      id,
      status: "succeeded",
      outcome: { application: "succeeded", updater, complete: false },
    });
    await expect(pollUpdateOperation({ id }, f)).rejects.toMatchObject({
      operationId: id,
    });
    expect(f.sleep).not.toHaveBeenCalled();
  },
);

it.each([
  undefined,
  null,
  {},
  { complete: true },
  { application: "succeeded", updater: "activating", complete: true },
  { application: "failed", updater: "succeeded", complete: true },
  { application: "succeeded", updater: ["succeeded"], complete: true },
])("cannot confirm a missing or inconsistent outcome (%j)", async (outcome) => {
  const f = fixture();
  f.read.mockResolvedValue({ id, status: "succeeded", outcome });
  await expect(pollUpdateOperation({ id }, f)).rejects.toBeInstanceOf(
    UpdateOperationUnconfirmedError,
  );
});

it("never accepts another operation's successful result", async () => {
  const f = fixture();
  f.read.mockResolvedValue({ ...completed, id: "updop_other" });
  await expect(pollUpdateOperation({ id }, f)).rejects.toMatchObject({
    operationId: id,
  });
});

it("accepts the server's explicit complete outcome when activation is not required", async () => {
  const f = fixture();
  const reply = {
    ...completed,
    outcome: { ...completed.outcome, updater: "not-required" },
  };
  f.read.mockResolvedValue(reply);
  expect(await pollUpdateOperation({ id }, f)).toBe(reply);
});

it("bounds a permanently activating Updater by the original deadline", async () => {
  const f = fixture();
  f.read.mockResolvedValue({
    id,
    status: "succeeded",
    outcome: {
      application: "succeeded",
      updater: "activating",
      complete: false,
    },
  });
  await expect(pollUpdateOperation({ id }, f)).rejects.toBeInstanceOf(
    UpdateOperationUnconfirmedError,
  );
  expect(f.now()).toBe(UPDATE_WAIT_MAX_MS);
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

it("does not report missing operation IDs as success or repeat the mutation", async () => {
  const f = fixture();
  await expect(
    pollUpdateOperation({ unchanged: true }, f),
  ).rejects.toMatchObject({ operationId: null });
  await expect(pollUpdateOperation({}, f)).rejects.toThrow(
    "Do not apply again. Check: update status",
  );
  expect(f.read).not.toHaveBeenCalled();
});

it("rejects unsafe operation IDs without requests", async () => {
  const f = fixture();
  await expect(
    pollUpdateOperation({ id: "unsafe\napply again" }, f),
  ).rejects.toThrow("Invalid update operation ID");
  expect(f.read).not.toHaveBeenCalled();
});

it("bounds individual HTTP reads by the remaining absolute deadline", async () => {
  const f = fixture();
  f.read.mockImplementation((_id, timeoutMs) => {
    if (f.now() === 0) {
      expect(timeoutMs).toBe(30_000);
      f.advance(UPDATE_WAIT_MAX_MS - 2_000);
      return Promise.resolve({ id, status: "running" });
    }
    expect(timeoutMs).toBe(500);
    f.advance(timeoutMs);
    return Promise.reject(new Error("request timed out"));
  });
  await expect(pollUpdateOperation({ id }, f)).rejects.toBeInstanceOf(
    UpdateOperationUnconfirmedError,
  );
  expect(f.read).toHaveBeenCalledTimes(2);
});
