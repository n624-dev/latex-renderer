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

export function containerMemoryProbe(
  name: string,
  inspect: (name: string) => Promise<string>,
) {
  let directory: string | undefined;
  let attempts = 0;
  return async (): Promise<number | undefined> => {
    try {
      if (!directory && attempts++ < 10)
        directory = containerMemoryDirectory(await inspect(name));
      if (!directory) return;
      const value = readFileSync(`${directory}/memory.peak`, "utf8").trim();
      if (!/^[0-9]{1,12}$/.test(value)) return;
      const peak = Number(value);
      if (Number.isSafeInteger(peak) && peak > 0) return peak;
    } catch {
      // Unavailable/removed cgroups are unknown, not evidence of a small Job.
    }
  };
}
