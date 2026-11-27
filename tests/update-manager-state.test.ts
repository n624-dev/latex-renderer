import { describe, expect, it, vi } from "vitest";
import { createUpdateManagerState } from "../deploy/scripts/update-manager-state.mjs";

describe("Update Manager state commits", () => {
  it("serializes concurrent patches and exposes only the persisted policy", async () => {
    let finish = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const initial: { policy: { mode: string }; available: string | null } = {
      policy: { mode: "notify" },
      available: null,
    };
    const write = vi.fn<(next: typeof initial) => Promise<void>>()
      .mockResolvedValue()
      .mockImplementationOnce(() => firstWrite);
    const state = createUpdateManagerState(initial, write);

    const automatic = state.update({ policy: { mode: "automatic" } });
    const notify = state.update({ policy: { mode: "notify" } });
    const release = state.update({ available: "1.2.3" });
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(state.current).toBe(initial);

    finish();
    await expect(automatic).resolves.toMatchObject({ policy: { mode: "automatic" } });
    await expect(notify).resolves.toMatchObject({ policy: { mode: "notify" } });
    await release;
    expect(state.current).toEqual(write.mock.lastCall?.[0]);
    expect(state.current).toMatchObject({
      policy: { mode: "notify" },
      available: "1.2.3",
    });
  });

  it("preserves committed state after a failed write and allows later updates", async () => {
    const write = vi.fn<() => Promise<void>>()
      .mockResolvedValue()
      .mockRejectedValueOnce(new Error("disk full"));
    const initial: { policy: { mode: string }; lastError?: string } = { policy: { mode: "notify" } };
    const state = createUpdateManagerState(initial, write);

    await expect(state.update({ policy: { mode: "automatic" } })).rejects.toThrow("disk full");
    expect(state.current).toBe(initial);
    await expect(state.update({ lastError: "disk full" })).resolves.toMatchObject({
      policy: { mode: "notify" },
      lastError: "disk full",
    });
  });
});
