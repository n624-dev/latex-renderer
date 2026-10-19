import { describe, expect, it } from "vitest";
import { assessHostResources } from "../apps/renderer-worker/src/admission.js";
describe("host render admission", () => {
  const ready = {
    availableBytes: 2048,
    memoryStallPercent: 0,
    ioStallPercent: 0,
  };
  it("admits a render only when the required headroom is available", () => {
    expect(assessHostResources(ready, 2048)).toBe("ready");
    expect(assessHostResources(ready, 2049)).toBe("memory_low");
  });
  it("does not interpret missing metrics as spare capacity", () => {
    expect(assessHostResources({ ...ready, availableBytes: null }, 1)).toBe(
      "metrics_unavailable",
    );
  });
  it("waits for severe memory or I/O stalls even if MemAvailable is sufficient", () => {
    expect(assessHostResources({ ...ready, memoryStallPercent: 10 }, 1)).toBe(
      "memory_pressure",
    );
    expect(assessHostResources({ ...ready, ioStallPercent: 50 }, 1)).toBe(
      "io_pressure",
    );
  });
});
