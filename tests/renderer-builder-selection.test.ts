import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const script = "deploy/scripts/ci-select-renderer-builder.sh";
function select(args: string[], env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "renderer-builder-fixture-"));
  try {
    const trace = join(root, "trace"),
      output = join(root, "output");
    writeFileSync(trace, "");
    writeFileSync(output, "");
    writeFileSync(
      join(root, "docker"),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_TRACE"
case "$*" in
  'buildx inspect '*--bootstrap) exit "\${TEST_BOOTSTRAP_EXIT:-0}" ;;
  'buildx inspect '*)
    printf 'Name: fixture\\nDriver: %s\\n' "$TEST_DRIVER"
    exit "\${TEST_INSPECT_EXIT:-0}" ;;
  *) exit 98 ;;
esac
`,
      { mode: 0o700 },
    );
    const result = spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      timeout: 5_000,
      env: {
        ...process.env,
        PATH: `${root}:${process.env.PATH}`,
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "github-hosted",
        TEST_TRACE: trace,
        GITHUB_OUTPUT: output,
        TEST_DRIVER: "docker",
        ...env,
      },
    });
    return {
      result,
      trace: readFileSync(trace, "utf8"),
      output: readFileSync(output, "utf8"),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe.skipIf(process.platform === "win32")(
  "ephemeral renderer builder selection",
  () => {
    it("uses the native builder without creating a container or changing the current selection", () => {
      const { result, trace, output } = select(["docker"]);
      expect(result.status, result.stderr).toBe(0);
      expect(output).toBe("name=default\ndriver=docker\n");
      expect(trace).toBe(
        "buildx inspect default\nbuildx inspect default --bootstrap\n",
      );
    });
    it("verifies the explicit previous container driver for comparison", () => {
      const { result, output } = select(
        ["docker-container", "fixture-builder"],
        { TEST_DRIVER: "docker-container" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(output).toBe("name=fixture-builder\ndriver=docker-container\n");
    });
    it.each(["", "self-hosted"])(
      "does not touch a non-ephemeral runner (%s)",
      (runner) => {
        const { result, trace, output } = select(["docker"], {
          RUNNER_ENVIRONMENT: runner,
        });
        expect(result.status).toBe(77);
        expect(trace).toBe("");
        expect(output).toBe("");
      },
    );
    it.each(["", "false"])(
      "does not touch a non-Actions host (%s)",
      (actions) => {
        const { result, trace } = select(["docker"], {
          GITHUB_ACTIONS: actions,
        });
        expect(result.status).toBe(77);
        expect(trace).toBe("");
      },
    );
    it.each([
      ["remote"],
      ["docker-container", "default"],
      ["docker-container", "../outside"],
      ["docker-container", "bad;name"],
    ])("rejects invalid selection %j before Docker access", (...args) => {
      const { result, trace } = select(args);
      expect(result.status).not.toBe(0);
      expect(trace).toBe("");
    });
    it("fails closed on a different driver rather than switching silently", () => {
      const { result, trace, output } = select(["docker"], {
        TEST_DRIVER: "remote",
      });
      expect(result.status).toBe(65);
      expect(output).toBe("");
      expect(trace).not.toContain("--bootstrap");
    });
    it("does not hide inspect failure behind a successful output parser", () => {
      const { result, output } = select(["docker"], {
        TEST_INSPECT_EXIT: "42",
      });
      expect(result.status).toBe(42);
      expect(output).toBe("");
    });
    it("does not announce success if bootstrap fails", () => {
      const { result, output } = select(["docker"], {
        TEST_BOOTSTRAP_EXIT: "42",
      });
      expect(result.status).toBe(42);
      expect(output).toBe("");
    });
  },
);

it("uses the selected driver without changing cold builds, publication or default-builder ownership", () => {
  for (const name of ["renderer-image", "renderer-image-daily"]) {
    const workflow = readFileSync(`.github/workflows/${name}.yml`, "utf8");
    expect(workflow).toContain(
      "CI_RENDERER_DRIVER: ${{ inputs.builder_driver || 'docker' }}",
    );
    expect(workflow).toContain(
      "if: env.CI_RENDERER_DRIVER == 'docker-container'",
    );
    expect(workflow).toContain("ci-select-renderer-builder.sh");
    expect(workflow).toContain("${{ steps.renderer-builder.outputs.name }}");
    expect(workflow).toContain("ci-validate-texlive-base.sh");
    expect(workflow).not.toContain("cache-to:");
    expect(workflow).not.toContain("cache-from:");
  }
  const pr = readFileSync(".github/workflows/renderer-image.yml", "utf8");
  expect(pr).toContain("no-cache: true");
  expect(pr).toContain("push: false");
  expect(pr).not.toContain("packages: write");
  const daily = readFileSync(
    ".github/workflows/renderer-image-daily.yml",
    "utf8",
  );
  expect(daily).toContain("--no-cache");
  expect(daily).not.toContain("docker buildx rm --force default");
  expect(daily).toContain('if [[ "${BUILDX_BUILDER:-default}" == default ]]');
});
