import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  containerMemoryDirectory,
  readContainerObservation,
} from "../apps/renderer-worker/src/container-memory.js";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(group: string) {
  const root = mkdtempSync(join(tmpdir(), "memory-cgroup-"));
  roots.push(root);
  const proc = join(root, "proc"),
    cgroup = join(root, "cgroup");
  mkdirSync(join(proc, "42"), { recursive: true });
  mkdirSync(cgroup);
  writeFileSync(join(proc, "42", "cgroup"), `0::${group}\n`);
  return { proc, cgroup };
}
describe("host-side renderer cgroup identity", () => {
  const id = "a".repeat(64);
  it("reports cumulative host samples with missing counters kept unknown", () => {
    const { cgroup } = fixture(`/docker/${id}`);
    writeFileSync(join(cgroup, "memory.peak"), "24000\n");
    writeFileSync(
      join(cgroup, "cpu.stat"),
      "usage_usec 9000\nuser_usec 8000\n",
    );
    writeFileSync(join(cgroup, "memory.events"), "oom 0\noom_kill 0\n");
    writeFileSync(
      join(cgroup, "io.stat"),
      "8:1 rbytes=20 wbytes=300\n8:2 rbytes=4 wbytes=15\n",
    );
    expect(readContainerObservation(cgroup)).toMatchObject({
      memoryPeakBytes: 24000,
      cpuUsageUs: 9000,
      ioReadBytes: 24,
      ioWriteBytes: 315,
      oomKills: 0,
    });
    const absent = join(cgroup, "absent");
    expect(readContainerObservation(absent)).toBeUndefined();
    writeFileSync(
      join(cgroup, "io.stat"),
      "8:1 rbytes=9999999999999999 wbytes=0\n",
    );
    expect(readContainerObservation(cgroup)).toMatchObject({
      ioReadBytes: null,
      ioWriteBytes: 0,
    });
  });
  it("accepts the exact delegated rootless container scope", () => {
    const group = `/user.slice/user-1001.slice/user@1001.service/app.slice/docker-${id}.scope`;
    const roots = fixture(group);
    mkdirSync(roots.cgroup + group, { recursive: true });
    expect(containerMemoryDirectory(`${id} 42`, roots)).toBe(
      join(roots.cgroup, group),
    );
  });
  it("accepts the exact cgroupfs container ID", () => {
    const group = `/docker/${id}`,
      roots = fixture(group);
    mkdirSync(roots.cgroup + group, { recursive: true });
    expect(containerMemoryDirectory(`${id} 42`, roots)).toBe(
      join(roots.cgroup, group),
    );
  });
  it.each([
    `/system.slice/docker-${"b".repeat(64)}.scope`,
    `/../../docker-${id}.scope`,
    "/system.slice/other.service",
  ])("rejects a reused PID or escaping/unrelated group: %s", (group) => {
    expect(
      containerMemoryDirectory(`${id} 42`, fixture(group)),
    ).toBeUndefined();
  });
  it.each(["", "invalid", `${id} 0`, `${id} 42\nsecret`, `${id}; true 42`])(
    "rejects malformed daemon identity: %s",
    (inspection) => {
      expect(containerMemoryDirectory(inspection)).toBeUndefined();
    },
  );
  it.skipIf(process.platform === "win32")(
    "rejects symlinks instead of following them out of the cgroup tree",
    () => {
      const roots = fixture(`/docker-${id}.scope`),
        outside = join(roots.proc, "outside");
      mkdirSync(outside);
      symlinkSync(outside, join(roots.cgroup, `docker-${id}.scope`));
      expect(containerMemoryDirectory(`${id} 42`, roots)).toBeUndefined();
    },
  );
});
