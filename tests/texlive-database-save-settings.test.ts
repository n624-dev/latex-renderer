import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = "deploy/scripts/ci-texlive-database-save-settings.sh";
function settings(batch: string, overrides: Record<string, string> = {}) {
  return spawnSync("sh", [script], {
    encoding: "utf8",
    timeout: 5_000,
    env: {
      ...process.env,
      CI_DATABASE_SAVE_BATCH: batch,
      GITHUB_ACTIONS: "true",
      RUNNER_ENVIRONMENT: "github-hosted",
      PUBLISH_REQUESTED: "false",
      ...overrides,
    },
  });
}

describe.skipIf(process.platform === "win32")(
  "disposable database save comparison",
  () => {
    it.each(["1", "16", "64"])("accepts supported comparison %s", (batch) => {
      const result = settings(batch);
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(`TEXLIVE_DATABASE_SAVE_BATCH=${batch}\n`);
    });
    it.each(["0", "65", "2", "1.5", "64; touch ignored", "../outside"])(
      "rejects invalid setting %s before any build",
      (batch) => {
        const result = settings(batch);
        expect(result.status).toBe(64);
        expect(result.stdout).toBe("");
      },
    );
    it("defaults to standard saving and keeps ordinary Daily publication", () => {
      const result = settings("", { PUBLISH_REQUESTED: "true" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("TEXLIVE_DATABASE_SAVE_BATCH=1\n");
    });
    it.each(["16", "64"])("does not allow candidate %s to publish", (batch) => {
      const result = settings(batch, { PUBLISH_REQUESTED: "true" });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe("");
    });
    it.each([
      { GITHUB_ACTIONS: "false" },
      { RUNNER_ENVIRONMENT: "self-hosted" },
      { RUNNER_ENVIRONMENT: "" },
    ])(
      "does not enable batching outside an ephemeral hosted runner: %j",
      (env) => {
        const result = settings("64", env);
        expect(result.status).toBe(77);
      },
    );
    it("keeps standard defaults, validates before Docker mutation, and forwards both args", () => {
      for (const file of ["renderer-image.yml", "renderer-image-daily.yml"]) {
        const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
        expect(workflow).toContain(
          "CI_DATABASE_SAVE_BATCH: ${{ inputs.database_save_batch || '1' }}",
        );
        expect(workflow.indexOf(script)).toBeLessThan(
          workflow.indexOf("uses: docker/setup-buildx-action"),
        );
        expect(workflow).toContain("TEXLIVE_DATABASE_SAVE_BATCH=");
        expect(workflow).toContain("TEXLIVE_DISPOSABLE_CI=1");
      }
      const dockerfile = readFileSync("renderer/Dockerfile.base", "utf8");
      expect(dockerfile).toContain("ARG TEXLIVE_DATABASE_SAVE_BATCH=1");
      expect(dockerfile).toContain("ARG TEXLIVE_DISPOSABLE_CI=0");
      expect(dockerfile).toContain("-MTeXLiveDatabaseBatch -MTeXLivePrefetch");
      expect(dockerfile).toContain(
        "install-tl --no-continue --persistent-downloads",
      );
      const daily = readFileSync(
        ".github/workflows/renderer-image-daily.yml",
        "utf8",
      );
      expect(daily).toContain(
        '"$CI_DATABASE_SAVE_BATCH" != 1 && "$tag_status" == present',
      );
    });
  },
);
