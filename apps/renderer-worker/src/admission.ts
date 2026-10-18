import { readFileSync } from "node:fs";

export interface HostResources {
  availableBytes: number | null;
  memoryStallPercent: number;
  ioStallPercent: number;
}
export function assessHostResources(
  resources: HostResources,
  minimumBytes: number,
) {
  if (resources.availableBytes === null) return "metrics_unavailable";
  if (resources.availableBytes < minimumBytes) return "memory_low";
  if (resources.memoryStallPercent >= 10) return "memory_pressure";
  if (resources.ioStallPercent >= 50) return "io_pressure";
  return "ready";
}
export function readHostResources(): HostResources {
  let availableBytes: number | null = null;
  try {
    const match = /^MemAvailable:\s+(\d+) kB$/m.exec(
      readFileSync("/proc/meminfo", "utf8"),
    );
    if (match !== null && Number.isSafeInteger(Number(match[1]) * 1024))
      availableBytes = Number(match[1]) * 1024;
  } catch {
    /* Unknown is not spare capacity. */
  }
  const stall = (kind: string) => {
    try {
      return Number(
        /^full avg10=([\d.]+)/m.exec(
          readFileSync(`/proc/pressure/${kind}`, "utf8"),
        )?.[1] ?? 0,
      );
    } catch {
      return 0; /* PSI is optional on older kernels. */
    }
  };
  return {
    availableBytes,
    memoryStallPercent: stall("memory"),
    ioStallPercent: stall("io"),
  };
}
