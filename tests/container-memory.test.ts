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
import { containerMemoryDirectory } from "../apps/renderer-worker/src/container-memory.js";
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
