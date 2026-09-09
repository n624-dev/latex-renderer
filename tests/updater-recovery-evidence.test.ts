import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import {
  assertStartupRecovery,
  brokenUpdaterSource,
} from "../deploy/ci/updater-recovery-evidence.mjs";

const evidence = () => ({
  failure: { status: 1, stderr: "Error: New Updater did not become healthy" },
  marker: { nonce: "this-attempt", cwd: "/slots/broken" },
  nonce: "this-attempt",
  brokenRoot: "/slots/broken",
  state: { current: "good", previous: "old", candidate: null, pending: null },
  before: { current: "good", previous: "old" },
});
it("requires evidence from the actual broken entry and complete rollback", () => {
  expect(() => assertStartupRecovery(evidence())).not.toThrow();
});
it("rejects the former false positive: lock busy, unchanged current", () => {
  expect(() =>
    assertStartupRecovery({
      ...evidence(),
      failure: { status: 1, stderr: "MUTATION_LOCK_BUSY" },
      marker: null,
    }),
  ).toThrow();
});
it("rejects absent or stale startup evidence even after a health error", () => {
  for (const marker of [
    null,
    { nonce: "old-attempt", cwd: "/slots/broken" },
    { nonce: "this-attempt", cwd: "/slots/good" },
  ])
    expect(() => assertStartupRecovery({ ...evidence(), marker })).toThrow();
});
it("rejects success, unexpected errors and incomplete rollback", () => {
  for (const failure of [
    null,
    { status: 0, stderr: "" },
    { status: 1, stderr: "unrelated failure" },
  ])
    expect(() => assertStartupRecovery({ ...evidence(), failure })).toThrow();
  for (const state of [
    { ...evidence().state, candidate: "broken" },
    { ...evidence().state, pending: { from: "good" } },
    { ...evidence().state, current: "broken" },
    { ...evidence().state, previous: "wrong" },
  ])
    expect(() => assertStartupRecovery({ ...evidence(), state })).toThrow();
});
it("the real generated fixture records startup before exiting with failure", () => {
  const root = mkdtempSync(join(tmpdir(), "updater-startup-evidence-"));
  try {
    const path = join(root, "started.json");
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", brokenUpdaterSource(path, "nonce")],
      { cwd: root, encoding: "utf8" },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("intentional E2E startup failure");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      nonce: "nonce",
      cwd: root,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
it("disables automatic CI activation before candidate deployment, without changing production units", () => {
  const source = readFileSync("deploy/ci/update-e2e.mjs", "utf8");
  expect(source.indexOf("90-ci-explicit-activation.conf")).toBeLessThan(
    source.indexOf("await deploy(candidate"),
  );
  expect(source).toContain(
    "ConditionPathExists=!/etc/latex-renderer-ci-host.json",
  );
  expect(source).toContain(
    "/run/systemd/system/latex-renderer-updater-activate.service.d",
  );
  expect(
    readFileSync(
      "deploy/systemd/latex-renderer-updater-activate.service",
      "utf8",
    ),
  ).not.toContain("latex-renderer-ci-host");
});
