import { expect, it, vi } from "vitest";
import { retryCiMutation } from "../deploy/ci/retry-ci-mutation.mjs";

const busy = () =>
  Object.assign(new Error("reconcile failed"), {
    stderr: Buffer.from("Error: busy\n  code: 'MUTATION_LOCK_BUSY'\n"),
  });

it.each([
  busy(),
  Object.assign(new Error("busy"), { code: "MUTATION_LOCK_BUSY" }),
])(
  "waits for a transient CI reconciliation conflict without treating it as success: %s",
  async (error) => {
    const action = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("verified");
    const wait = vi.fn(() => Promise.resolve());
    await expect(retryCiMutation(action, { wait })).resolves.toBe("verified");
    expect(action).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(250);
  },
);

it("preserves the final busy failure at the retry bound", async () => {
  const error = busy(),
    action = vi.fn(() => {
      throw error;
    });
  const wait = vi.fn(() => Promise.resolve());
  await expect(retryCiMutation(action, { attempts: 2, wait })).rejects.toBe(
    error,
  );
  expect(action).toHaveBeenCalledTimes(2);
  expect(wait).toHaveBeenCalledTimes(1);
});

it.each([
  new Error("checksum mismatch"),
  Object.assign(new Error("different failure"), {
    stderr: "permission denied",
  }),
])("does not retry an unrelated failure", async (error) => {
  const action = vi.fn(() => {
      throw error;
    }),
    wait = vi.fn(() => Promise.resolve());
  await expect(retryCiMutation(action, { wait })).rejects.toBe(error);
  expect(action).toHaveBeenCalledTimes(1);
  expect(wait).not.toHaveBeenCalled();
});

it.each([0, 61, 1.5, NaN])(
  "rejects an invalid retry bound %s",
  async (attempts) => {
    const action = vi.fn();
    await expect(retryCiMutation(action, { attempts })).rejects.toThrow(
      "1..60",
    );
    expect(action).not.toHaveBeenCalled();
  },
);
