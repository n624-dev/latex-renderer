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
  "disposable database save settings",
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
    it("allows the validated 64 default to publish only on hosted CI", () => {
      const result = settings("64", { PUBLISH_REQUESTED: "true" });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("TEXLIVE_DATABASE_SAVE_BATCH=64\n");
      const selfHosted = settings("64", {
        PUBLISH_REQUESTED: "true",
        RUNNER_ENVIRONMENT: "self-hosted",
      });
      expect(selfHosted.status).toBe(77);
      expect(selfHosted.stdout).toBe("");
    });
    it("does not allow the 16 comparison to publish", () => {
      const batch = "16";
      const result = settings(batch, { PUBLISH_REQUESTED: "true" });
      expect(result.status).toBe(64);
      expect(result.stdout).toBe("");
    });
    it.each(["TRUE", "yes", "false; ignored", " "])(
      "rejects an invalid publication setting %s",
      (publish) => {
        for (const batch of ["1", "16", "64"]) {
          const result = settings(batch, { PUBLISH_REQUESTED: publish });
          expect(result.status).toBe(64);
          expect(result.stdout).toBe("");
        }
      },
    );
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
    it.each([
      ["1", "present"],
      ["16", "present"],
      ["64", "present"],
      ["1", "absent"],
      ["16", "absent"],
      ["64", "absent"],
    ])("keeps Daily reuse semantics for batch %s and tag %s", (batch, tag) => {
      const workflow = readFileSync(
        ".github/workflows/renderer-image-daily.yml",
        "utf8",
      );
      const guard = workflow.match(
        /if \[\[ "\$CI_DATABASE_SAVE_BATCH" == 16 && "\$tag_status" == present \]\]; then[\s\S]*?\n\s*fi/,
      );
      expect(guard).not.toBeNull();
      if (!guard) throw new Error("Daily database-save reuse guard is missing");
      const result = spawnSync("bash", ["-c", guard[0]], {
        encoding: "utf8",
        timeout: 5_000,
        env: {
          ...process.env,
          CI_DATABASE_SAVE_BATCH: batch,
          tag_status: tag,
        },
      });
      expect(result.status, result.stderr).toBe(
        batch === "16" && tag === "present" ? 64 : 0,
      );
    });
    it("uses hosted 64, keeps host defaults, validates before Docker mutation, and forwards both args", () => {
      for (const file of ["renderer-image.yml", "renderer-image-daily.yml"]) {
        const workflow = readFileSync(`.github/workflows/${file}`, "utf8");
        expect(workflow).toContain(
          "CI_DATABASE_SAVE_BATCH: ${{ inputs.database_save_batch || '64' }}",
        );
        expect(workflow).toMatch(
          /database_save_batch:\s*\n[\s\S]*?options: \["1", "16", "64"\]\s*\n\s*default: "64"/,
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
        '"$CI_DATABASE_SAVE_BATCH" == 16 && "$tag_status" == present',
      );
    });
  },
);
