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

export function resourceWaitMessage(
  state: ReturnType<typeof assessHostResources>,
  resources: HostResources,
  requiredBytes: number,
  longWait: boolean,
): string {
  const reasons = {
    ready: "開始可能",
    memory_low: "空きメモリ不足",
    memory_pressure: "メモリ回収の負荷が高い",
    io_pressure: "ディスクI/Oの負荷が高い",
    metrics_unavailable: "メモリ情報を取得できない",
  };
  const mib = (bytes: number) => Math.ceil(bytes / 1024 ** 2);
  return `${reasons[state]}のため開始待機中です。利用可能メモリ: ${resources.availableBytes === null ? "不明" : `${Math.floor(resources.availableBytes / 1024 ** 2)}MiB`}、開始条件: ${mib(requiredBytes)}MiB。${longWait ? "長時間待機していますが、待機だけではJobを失敗にしません。" : "条件が整うと自動的に開始します。"}不要になった場合はキャンセルできます。`;
}
