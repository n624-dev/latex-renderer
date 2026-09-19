import { describe, expect, it, vi } from "vitest";
import { retryRenderCapacity } from "../apps/admin-web/src/assets/app-script.js";

describe("App render capacity retry", () => {
  it.each([
    ["ACCOUNT_QUEUE_LIMIT", 429],
    ["USER_QUEUE_LIMIT", 429],
    ["QUEUE_FULL", 503],
  ])("bounds %s retries and keeps the same operation", async (code, status) => {
    const error = Object.assign(new Error("capacity"), { code, status });
    const operation = vi.fn().mockRejectedValue(error);
    const notify = vi.fn(),
      wait = vi
        .fn<(delay: number) => Promise<void>>()
        .mockResolvedValue(undefined);
    await expect(retryRenderCapacity(operation, notify, wait)).rejects.toBe(
      error,
    );
    expect(operation).toHaveBeenCalledTimes(6);
    expect(notify).toHaveBeenCalledTimes(5);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([
      1000, 2000, 4000, 8000, 8000,
    ]);
  });

  it.each([
    ["MAINTENANCE", 503],
    ["STORAGE_PRESSURE", 503],
    ["QUEUE_FULL", 500],
    ["ACCOUNT_QUEUE_LIMIT", 403],
    ["HTTP_ERROR", 429],
    [undefined, undefined],
  ])(
    "does not retry ambiguous or permanent %s/%s errors",
    async (code, status) => {
      const error = Object.assign(new Error("failure"), { code, status });
      const operation = vi.fn().mockRejectedValue(error),
        wait = vi.fn();
      await expect(retryRenderCapacity(operation, vi.fn(), wait)).rejects.toBe(
        error,
      );
      expect(operation).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it("returns immediately after capacity recovers", async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error(), {
          code: "QUEUE_FULL",
          status: 503,
        }),
      )
      .mockResolvedValue("ticket");
    await expect(
      retryRenderCapacity(operation, vi.fn(), async () => {}),
    ).resolves.toBe("ticket");
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
