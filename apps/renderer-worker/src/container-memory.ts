import { readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";

/** Resolve only a cgroup belonging to the daemon's exact container ID. A PID
 * alone can be reused; neither a document nor an output path selects a file. */
export function containerMemoryDirectory(
  inspection: string,
  roots = { proc: "/proc", cgroup: "/sys/fs/cgroup" },
): string | undefined {
  const match = /^([a-f0-9]{64}) ([1-9][0-9]*)$/.exec(inspection.trim());
  if (!match) return;
  try {
    const membership = readFileSync(`${roots.proc}/${match[2]}/cgroup`, "utf8");
    const group = /^0::(\/[^\n]*)$/m.exec(membership)?.[1];
    if (
      !group ||
      group.split("/").some((p) => p === ".." || p === ".") ||
      !new RegExp(`/(?:docker-)?${match[1]}(?:\\.scope)?$`).test(group)
    )
      return;
    const root = resolve(roots.cgroup),
      directory = resolve(root, `.${group}`);
    if (!directory.startsWith(root + sep)) return;
    if (realpathSync(directory) !== directory) return;
    return directory;
  } catch {
    return;
  }
}

export interface ContainerObservation {
  memoryPeakBytes: number | null;
  cpuUsageUs: number | null;
  ioReadBytes: number | null;
  ioWriteBytes: number | null;
  oomKills: number | null;
  sampledAt: string;
}

export function containerObservationProbe(
  name: string,
  inspect: (name: string) => Promise<string>,
) {
  let directory: string | undefined;
  let attempts = 0;
  return async (): Promise<ContainerObservation | undefined> => {
    if (!directory && attempts++ < 10)
      directory = containerMemoryDirectory(await inspect(name));
    if (!directory) return;
    return readContainerObservation(directory);
  };
}

export function readContainerObservation(
  directory: string,
): ContainerObservation | undefined {
  const read = (name: string) => {
    try {
      return readFileSync(`${directory}/${name}`, "utf8").trim();
    } catch {
      return undefined;
    }
  };
  const counter = (value: string | undefined) => {
    if (value === undefined || !/^\d{1,16}$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) ? number : null;
  };
  const memoryPeakBytes = counter(read("memory.peak"));
  const cpuUsageUs = counter(
    /^usage_usec (\d+)$/m.exec(read("cpu.stat") ?? "")?.[1],
  );
  const oomKills = counter(
    /^oom_kill (\d+)$/m.exec(read("memory.events") ?? "")?.[1],
  );
  const io = read("io.stat");
  const total = (kind: "rbytes" | "wbytes") => {
    if (!io) return null;
    const counters = [
      ...io.matchAll(new RegExp(`(?:^| )${kind}=(\\d+)(?= |$)`, "gm")),
    ];
    if (!counters.length) return null;
    const values = counters.map((match) => counter(match[1]));
    if (values.some((value) => value === null)) return null;
    const bytes = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    return Number.isSafeInteger(bytes) ? bytes : null;
  };
  const ioReadBytes = total("rbytes"),
    ioWriteBytes = total("wbytes");
  if (
    [memoryPeakBytes, cpuUsageUs, oomKills, ioReadBytes, ioWriteBytes].every(
      (value) => value === null,
    )
  )
    return;
  return {
    memoryPeakBytes,
    cpuUsageUs,
    ioReadBytes,
    ioWriteBytes,
    oomKills,
    sampledAt: new Date().toISOString(),
  };
}
