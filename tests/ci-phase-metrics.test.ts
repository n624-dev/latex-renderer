import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = new URL("../deploy/ci/measure-phase.mjs", import.meta.url)
  .pathname;
interface Metrics {
  phase: string;
  elapsedSeconds: number;
  userCpuSeconds: number;
  systemCpuSeconds: number;
  maxProcessRssBytes: number;
  minimumFilesystemFreeBytes: number[];
  sampledFilesystemGrowthBytes: number[];
  exitCode: number;
}
function measured(code: string, args: string[] = []) {
  const root = mkdtempSync(join(tmpdir(), "ci-metrics-test-"));
  try {
    const summary = join(root, "summary.md");
    const result = spawnSync(
      process.execPath,
      [script, "fixture", "--", process.execPath, "--eval", code, ...args],
      {
        encoding: "utf8",
        timeout: 5_000,
        env: { ...process.env, TMPDIR: root, GITHUB_STEP_SUMMARY: summary },
      },
    );
    expect(result.error).toBeUndefined();
    const line = result.stdout
      .split("\n")
      .find((line) => line.startsWith("CI_PHASE_METRICS "));
    expect(line, result.stderr).toBeDefined();
    if (!line) throw new Error("Missing phase measurements");
    const metrics = JSON.parse(
      line.slice("CI_PHASE_METRICS ".length),
    ) as Metrics;
    expect(readdirSync(root)).toEqual(["summary.md"]);
    return { result, metrics, summary: readFileSync(summary, "utf8") };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform !== "linux")("Linux phase measurement", () => {
  it("reports real elapsed/CPU/RSS, emits a bounded summary, and removes its temporary report", () => {
    const { result, metrics, summary } = measured(
      "console.log('fixture child output')",
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("fixture child output");
    expect(metrics.phase).toBe("fixture");
    expect(metrics.elapsedSeconds).toBeGreaterThan(0);
    expect(metrics.userCpuSeconds).toBeGreaterThanOrEqual(0);
    expect(metrics.systemCpuSeconds).toBeGreaterThanOrEqual(0);
    expect(metrics.maxProcessRssBytes).toBeGreaterThan(0);
    expect(metrics.minimumFilesystemFreeBytes).toHaveLength(2);
    expect(metrics.sampledFilesystemGrowthBytes).toHaveLength(2);
    expect(summary).toContain("not an exact temporary-directory peak");
    expect(summary.length).toBeLessThan(1_000);
  });
  it("keeps a failed check failed and still emits measurements", () => {
    const { result, metrics, summary } = measured("process.exit(7)");
    expect(result.status).toBe(7);
    expect(metrics.exitCode).toBe(7);
    expect(summary).toContain("exit: 7");
  });
  it("passes arguments without shell evaluation or dumping credentials", () => {
    const marker = "$(echo must-not-execute); synthetic-secret-value";
    const { result, summary } = measured(
      "if (process.argv[1] !== process.argv[2]) process.exit(8)",
      [marker, marker],
    );
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain(marker);
    expect(summary).not.toContain(marker);
  });
  it("rejects invalid labels and incomplete command lines", () => {
    for (const args of [
      ["unsafe\nlabel", "--", "true"],
      ["fixture", "--"],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], {
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain("CI_PHASE_METRICS");
    }
  });
});
