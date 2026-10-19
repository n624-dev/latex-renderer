import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("disposable renderer I/O benchmark", () => {
  it("refuses to run large comparisons on an ordinary host", () => {
    const run = spawnSync(
      "sh",
      ["deploy/scripts/ci-renderer-io-benchmark.sh", "unused"],
      {
        env: {
          ...process.env,
          GITHUB_ACTIONS: "false",
          RUNNER_ENVIRONMENT: "",
        },
      },
    );
    expect(run.status).toBe(77);
  });
  it("reuses the validated Runtime before its cleanup, without publishing it", () => {
    const script = readFileSync(
      "deploy/scripts/ci-validate-texlive-base.sh",
      "utf8",
    );
    expect(script).toContain("CI_RENDERER_IO_BENCHMARK:-0");
    expect(script.indexOf("run_stage renderer-io-benchmark")).toBeGreaterThan(
      script.indexOf("run_stage source-pipeline"),
    );
    expect(script.indexOf("run_stage renderer-io-benchmark")).toBeLessThan(
      script.lastIndexOf("\ncleanup\n"),
    );
    const bench = readFileSync(
      "deploy/scripts/ci-renderer-io-benchmark.sh",
      "utf8",
    );
    expect(bench).toContain("for pages in 1 10 50 100");
    expect(bench).toContain("for outputs in pdf pdf,svg");
    expect(bench).toContain("--memory 1g --memory-swap 1g");
    expect(bench).not.toContain("docker push");
  });
});
