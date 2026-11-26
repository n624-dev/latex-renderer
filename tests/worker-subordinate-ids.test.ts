import { describe, expect, it } from "vitest";
import { workerIdRange } from "../deploy/scripts/worker-subordinate-ids.mjs";

const worker = ["latex-render-worker", "900"];
const limits = { minimum: 100_000, maximum: 1_000_000 };

describe("rootless Worker subordinate IDs", () => {
  it("allocates the first sufficiently large gap allowed by the host", () => {
    expect(workerIdRange("", worker, limits)).toEqual({ first: 100_000, last: 165_535 });
    expect(workerIdRange("other:100000:65536\nother2:170000:65536", worker, limits))
      .toEqual({ first: 235_536, last: 301_071 });
  });

  it("keeps a valid existing numeric-owner range", () => {
    expect(workerIdRange("900:165536:65536", worker, limits)).toBeUndefined();
  });

  it("rejects existing collisions, insufficient capacity and malformed input", () => {
    expect(() => workerIdRange("900:165536:65536\nother:200000:65536", worker, limits)).toThrow("overlaps");
    expect(() => workerIdRange("900:165536:1", worker, limits)).toThrow("too small");
    expect(() => workerIdRange("other:100000:400000", worker, { minimum: 100_000, maximum: 499_999 })).toThrow("No unallocated");
    expect(() => workerIdRange("other:not-a-number:65536", worker, limits)).toThrow("Malformed");
  });
});
