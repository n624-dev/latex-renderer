import { describe, expect, it } from "vitest";
import {
  assessHostResources,
  resourceWaitMessage,
} from "../apps/renderer-worker/src/admission.js";
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
  it("explains memory and pressure waits without representing waiting as a failed render", () => {
    const message = resourceWaitMessage(
      "memory_low",
      { ...ready, availableBytes: 700 * 1024 ** 2 },
      832 * 1024 ** 2,
      true,
    );
    expect(message).toContain("700MiB");
    expect(message).toContain("832MiB");
    expect(message).toContain("待機だけではJobを失敗にしません");
    expect(resourceWaitMessage("io_pressure", ready, 1, false)).toContain(
      "ディスクI/O",
    );
    expect(
      resourceWaitMessage(
        "metrics_unavailable",
        { ...ready, availableBytes: null },
        1,
        false,
      ),
    ).toContain("不明");
  });
});
