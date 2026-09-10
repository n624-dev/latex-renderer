import {
  link,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  collectUpdateLogs,
  updateLogPolicy,
} from "../deploy/scripts/update-log-retention.mjs";

const roots: string[] = [];
// Whole seconds avoid filesystem timestamp precision affecting expiry edges.
const now = Date.UTC(2026, 0, 10);
const policy = {
  maxBytes: 40,
  reserveBytes: 4,
  retentionMs: 7 * 86400000,
  intervalMs: 900000,
};
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "update-log-retention-"));
  roots.push(root);
  return root;
}
async function log(root: string, index: number, size = 4, age = 0) {
  const id = `updop_${index}_fixture`;
  const path = join(root, `${id}.log`);
  await writeFile(path, "x".repeat(size));
  await utimes(path, new Date(now - age), new Date(now - age));
  return id;
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("defaults to seven days, 40 MiB total, 4 MiB reserved and 15-minute collection", () => {
  expect(updateLogPolicy({}, 4194304)).toEqual({
    maxBytes: 41943040,
    reserveBytes: 4194304,
    retentionMs: 604800000,
    intervalMs: 900000,
  });
});
it.each(["0", "-1", "1.5", "NaN", "366"])(
  "rejects invalid retention %s",
  (value) => {
    expect(() =>
      updateLogPolicy({ UPDATE_LOG_RETENTION_DAYS: value }, 4194304),
    ).toThrow();
  },
);
it("rejects a total budget below the single operation cap", () => {
  expect(() =>
    updateLogPolicy({ UPDATE_LOG_TOTAL_MAX_BYTES: "65536" }, 4194304),
  ).toThrow();
});
it("expires idle and orphan logs, preserving result history and unrelated files", async () => {
  const root = await fixture();
  const id = await log(root, 1, 4, policy.retentionMs);
  await writeFile(join(root, `${id}.json`), '{"status":"failed"}');
  await writeFile(join(root, "not-managed.log"), "keep");
  await log(root, 2, 4, policy.retentionMs - 1000);
  expect(
    await collectUpdateLogs({ root, policy, activeId: () => null, now }),
  ).toEqual({ deleted: 1 });
  expect(await readFile(join(root, `${id}.json`), "utf8")).toBe(
    '{"status":"failed"}',
  );
  expect(await readdir(root)).toEqual(
    expect.arrayContaining(["not-managed.log", "updop_2_fixture.log"]),
  );
  expect(
    await collectUpdateLogs({ root, policy, activeId: () => null, now }),
  ).toEqual({ deleted: 0 });
});
it("removes oldest logs for capacity and reserves room for the next capped log", async () => {
  const root = await fixture();
  await log(root, 1, 20, 2000);
  await log(root, 2, 20, 1000);
  await log(root, 3, 16);
  expect(
    await collectUpdateLogs({ root, policy, activeId: () => null, now }),
  ).toEqual({ deleted: 1 });
  expect(await readdir(root)).toEqual([
    "updop_2_fixture.log",
    "updop_3_fixture.log",
  ]);
});
it("protects an active expired log and collects it after completion or restart", async () => {
  const root = await fixture();
  let active: string | null = await log(root, 1, 4, policy.retentionMs + 1000);
  await log(root, 2, 37, 1000);
  await collectUpdateLogs({ root, policy, activeId: () => active, now });
  expect(await readdir(root)).toEqual([`${active}.log`]);
  active = null;
  expect(
    await collectUpdateLogs({ root, policy, activeId: () => active, now }),
  ).toEqual({ deleted: 1 });
});
it.each(["symlink", "hardlink"])(
  "fails closed on an external %s without deleting other logs",
  async (kind) => {
    const root = await fixture();
    const outside = await fixture();
    const external = join(outside, "keep");
    await writeFile(external, "private-data");
    await log(root, 1, 4, policy.retentionMs + 1000);
    await (kind === "symlink" ? symlink : link)(
      external,
      join(root, "updop_2_fixture.log"),
    );
    await expect(
      collectUpdateLogs({ root, policy, activeId: () => null, now }),
    ).rejects.toThrow("Unsafe update log entry");
    expect(await readFile(external, "utf8")).toBe("private-data");
    expect(await readdir(root)).toHaveLength(2);
  },
);
it("rejects a linked operations directory", async () => {
  const parent = await fixture();
  const root = await fixture();
  await symlink(root, join(parent, "operations"));
  await expect(
    collectUpdateLogs({
      root: join(parent, "operations"),
      policy,
      activeId: () => null,
      now,
    }),
  ).rejects.toThrow("Unsafe update log directory");
});
it("wires collection into idle time, startup and operations with signed helper packaging", async () => {
  const source = await readFile("deploy/scripts/update-manager.mjs", "utf8");
  expect(source).toContain(
    "await cleanupStagingRoot();\nawait cleanupOperationLogs();",
  );
  expect(source).toContain("}, logPolicy.intervalMs).unref();");
  expect(source).toContain("await operation.logWrite?.catch(() => {});");
  expect(source.indexOf("await operation.logWrite?.catch")).toBeLessThan(
    source.lastIndexOf("activeOperation = null;"),
  );
  expect(
    JSON.parse(await readFile("deploy/updater-files.json", "utf8")),
  ).toContain("deploy/scripts/update-log-retention.mjs");
});
