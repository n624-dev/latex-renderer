import { expect, it } from "vitest";
import { createLanHttpsRateLimit } from "../deploy/lan-https/rate-limit.mjs";

it("bounds per-source and global work, remembers a finite number of sources and expires the whole window", () => {
  let now = 100;
  const limiter = createLanHttpsRateLimit({
    maxKeys: 2,
    requestsPerKey: 2,
    requestsTotal: 3,
    windowMs: 1000,
    now: () => now,
  });
  expect(limiter.allow("a")).toBe(true);
  expect(limiter.allow("a")).toBe(true);
  expect(limiter.allow("a")).toBe(false);
  expect(limiter.allow("b")).toBe(true);
  expect(limiter.allow("b")).toBe(false);
  expect(limiter.allow("c")).toBe(false);
  expect(limiter.sourceCount).toBe(2);
  now = 1100;
  expect(limiter.allow("c")).toBe(true);
  expect(limiter.sourceCount).toBe(1);
  now = 1;
  expect(limiter.allow("c")).toBe(false);
});
it("does not evict another source to accept an unbounded stream of new identities", () => {
  const limiter = createLanHttpsRateLimit({
    maxKeys: 1,
    requestsPerKey: 2,
    requestsTotal: 10,
  });
  expect(limiter.allow("existing")).toBe(true);
  for (let i = 0; i < 100; i++) expect(limiter.allow(String(i))).toBe(false);
  expect(limiter.sourceCount).toBe(1);
  expect(limiter.allow("existing")).toBe(true);
  expect(limiter.allow("".padStart(129, "a"))).toBe(false);
});
