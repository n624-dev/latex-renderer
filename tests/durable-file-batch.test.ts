import { expect, it } from "vitest";
import { DurableFileBatch } from "../deploy/scripts/durable-file-batch.mjs";

it.each([0, 5, 1.5, NaN])(
  "rejects invalid durability batch size %s",
  (size) => {
    expect(() => new DurableFileBatch(size)).toThrow(/between 1 and 4/);
  },
);
it("bounds open descriptors and sync concurrency and flushes the final partial batch", async () => {
  const batch = new DurableFileBatch(4);
  let active = 0,
    peak = 0,
    closed = 0;
  for (let n = 0; n < 11; n++) {
    await batch.add({
      sync: async () => {
        peak = Math.max(peak, ++active);
        await Promise.resolve();
        active--;
      },
      close: () => {
        closed++;
        return Promise.resolve();
      },
    });
    expect(n + 1 - closed).toBeLessThan(4);
  }
  expect(closed).toBe(8);
  await batch.flush();
  expect(peak).toBe(4);
  expect(closed).toBe(11);
});
it.each(["EIO", "ENOSPC"])(
  "drains every in-flight sync and closes every descriptor on %s",
  async (code) => {
    const batch = new DurableFileBatch(2);
    const failure = Object.assign(new Error(code), { code });
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const closed: number[] = [];
    await batch.add({
      sync: () => Promise.reject(failure),
      close: () => {
        closed.push(1);
        return Promise.resolve();
      },
    });
    let settled = false;
    const flush = batch.add({
      sync: () => gate,
      close: () => {
        closed.push(2);
        return Promise.resolve();
      },
    });
    const check = expect(
      flush.finally(() => {
        settled = true;
      }),
    ).rejects.toBe(failure);
    await Promise.resolve();
    expect(settled).toBe(false);
    finish();
    await check;
    expect(closed.sort()).toEqual([1, 2]);
    await batch.discard();
    expect(closed).toHaveLength(2);
  },
);
it("preserves sync errors over close errors and discards pending handles without syncing", async () => {
  const batch = new DurableFileBatch(1);
  await expect(
    batch.add({
      sync: () => Promise.reject(new Error("sync")),
      close: () => Promise.reject(new Error("close")),
    }),
  ).rejects.toThrow("sync");
  await expect(
    batch.add({
      sync: () => Promise.resolve(),
      close: () => Promise.reject(new Error("close")),
    }),
  ).rejects.toThrow("close");
  const pending = new DurableFileBatch(4);
  let closed = 0,
    synced = 0;
  await pending.add({
    sync: () => {
      synced++;
      return Promise.resolve();
    },
    close: () => {
      closed++;
      return Promise.resolve();
    },
  });
  await pending.discard();
  expect([synced, closed]).toEqual([0, 1]);
});
