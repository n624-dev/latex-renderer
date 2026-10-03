import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Base-only CI validation failure boundaries", () => {
  it.each([200, 404, 401, 403, 429, 500])(
    "only a registry manifest 404 means absent (HTTP %s)",
    (status) => {
      const script = new URL(
        "../deploy/scripts/ghcr-tag-status.mjs",
        import.meta.url,
      ).href;
      // Pass fixture data separately; never interpolate it into executable code.
      const code = `let calls=0; globalThis.fetch=()=>Promise.resolve(++calls===1 ? Response.json({token:'synthetic-token'}) : new Response(null,{status:Number(process.env.TEST_REGISTRY_STATUS)})); process.argv[2]='2026-09-05'; await import(process.env.TEST_REGISTRY_SCRIPT);`;
      const result = spawnSync(
        process.execPath,
        ["--input-type=module", "-e", code],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            GITHUB_TOKEN: "",
            GHCR_REPOSITORY: "ghcr.io/test-owner/test-image",
            TEST_REGISTRY_STATUS: String(status),
            TEST_REGISTRY_SCRIPT: script,
          },
        },
      );
      if (status === 200 || status === 404) {
        expect(result.status).toBe(0);
        expect(result.stdout.trim()).toBe(
          status === 200 ? "present" : "absent",
        );
      } else {
        expect(result.status).not.toBe(0);
        expect(result.stdout).not.toContain("absent");
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "fails before a large stage when disk is insufficient",
    () => {
      const root = mkdtempSync(join(tmpdir(), "renderer-ci-disk-"));
      try {
        writeFileSync(
          join(root, "df"),
          '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted\\n/dev/test 999999 999998 1 99%% /\\n"\n',
          { mode: 0o700 },
        );
        writeFileSync(join(root, "docker"), "#!/bin/sh\nexit 0\n", {
          mode: 0o700,
        });
        const result = spawnSync(
          "sh",
          ["deploy/scripts/ci-renderer-disk.sh", "before-test", "6"],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              GITHUB_ACTIONS: "true",
              RUNNER_ENVIRONMENT: "github-hosted",
            },
          },
        );
        expect(result.status).toBe(70);
        expect(result.stderr).toContain("Insufficient free disk");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it
    .skipIf(process.platform === "win32")
    .each(
      ["", "default", "fixture-container"].flatMap((builder) =>
        [
          "",
          "smoke-test-texlive-base.sh",
          "build-language-runtime.sh",
          "smoke-test-renderer-basic.sh",
          "smoke-test-renderer-en-jp.sh",
          "smoke-test-renderer-svg.sh",
          "smoke-test-renderer-compat.sh",
          "ci-source-pipeline-e2e.sh",
        ].map((failedStage) => ({ builder, failedStage })),
      ),
    )(
    "cleans temporary Runtime on success or failure at $failedStage with builder $builder",
    ({ builder, failedStage }) => {
      const root = mkdtempSync(join(tmpdir(), "renderer-ci-contract-"));
      try {
        writeFileSync(
          join(root, "validate.sh"),
          readFileSync("deploy/scripts/ci-validate-texlive-base.sh"),
        );
        const names = [
          "smoke-test-texlive-base.sh",
          "ci-renderer-disk.sh",
          "build-language-runtime.sh",
          "smoke-test-renderer-basic.sh",
          "smoke-test-renderer-en-jp.sh",
          "smoke-test-renderer-svg.sh",
          "smoke-test-renderer-compat.sh",
          "ci-source-pipeline-e2e.sh",
        ];
        for (const name of names)
          writeFileSync(
            join(root, name),
            `#!/bin/sh\necho '${name}' >> "$TEST_TRACE"\nif [ '${name}' = build-language-runtime.sh ]; then [ "$RUNTIME_NO_CACHE" = true ] && [ "$RUNTIME_FORMAT_JOBS" = 4 ] || exit 91; fi\n[ "$FAIL_STAGE" != '${name}' ] || exit 42\n`,
            { mode: 0o700 },
          );
        writeFileSync(
          join(root, "docker"),
          `#!/bin/sh\necho "docker $*" >> "$TEST_TRACE"\ncase "$*" in\n *Config.Labels*languages*) echo collection-langenglish,collection-langjapanese ;;\n *Config.Labels*runtime-kind*) echo managed-local-v1 ;;\nesac\n`,
          { mode: 0o700 },
        );
        const trace = join(root, "trace");
        const result = spawnSync(
          "sh",
          [
            join(root, "validate.sh"),
            "test-base",
            "https://snapshot.example.test/tlnet",
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              GITHUB_ACTIONS: "true",
              RUNNER_ENVIRONMENT: "github-hosted",
              GITHUB_RUN_ID: "123",
              GITHUB_RUN_ATTEMPT: "2",
              BUILDX_BUILDER: builder,
              CI_FORMAT_JOBS: "",
              TEST_TRACE: trace,
              FAIL_STAGE: failedStage,
            },
          },
        );
        expect(result.status, result.stderr).toBe(failedStage ? 42 : 0);
        const stages: Record<string, string> = {
          "smoke-test-texlive-base.sh": "base-smoke",
          "build-language-runtime.sh": "language-runtime",
          "smoke-test-renderer-basic.sh": "basic",
          "smoke-test-renderer-en-jp.sh": "en-jp",
          "smoke-test-renderer-svg.sh": "svg",
          "smoke-test-renderer-compat.sh": "compat",
          "ci-source-pipeline-e2e.sh": "source-pipeline",
        };
        if (failedStage) {
          expect(result.stdout).toMatch(
            new RegExp(
              `TEXLIVE_CI_STAGE stage=${stages[failedStage]} seconds=\\d+ exit=42`,
            ),
          );
        } else {
          for (const stage of Object.values(stages))
            expect(result.stdout).toMatch(
              new RegExp(`TEXLIVE_CI_STAGE stage=${stage} seconds=\\d+ exit=0`),
            );
        }
        const commands = readFileSync(trace, "utf8");
        expect(
          commands.match(/docker image rm latex-renderer:ci-validation-123-2/g)
            ?.length,
        ).toBeGreaterThanOrEqual(2);
        expect(commands).not.toContain("docker push");
        expect(commands).toContain("docker builder prune --all --force");
        if (
          builder === "fixture-container" &&
          failedStage !== "smoke-test-texlive-base.sh"
        ) {
          expect(commands).toContain(
            "docker buildx prune --builder fixture-container --all --force",
          );
        } else {
          expect(commands).not.toContain("docker buildx prune");
        }
        if (failedStage === "smoke-test-texlive-base.sh")
          expect(commands).not.toContain("build-language-runtime.sh");
        if (!failedStage)
          expect(
            commands.indexOf("smoke-test-renderer-svg.sh"),
          ).toBeGreaterThan(commands.indexOf("build-language-runtime.sh"));
        if (!failedStage)
          expect(
            commands.indexOf("smoke-test-renderer-compat.sh"),
          ).toBeGreaterThan(commands.indexOf("smoke-test-renderer-svg.sh"));
        if (!failedStage)
          expect(commands.indexOf("ci-source-pipeline-e2e.sh")).toBeGreaterThan(
            commands.indexOf("smoke-test-renderer-compat.sh"),
          );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "never prunes on a persistent or production host",
    () => {
      for (const script of [
        "ci-renderer-disk.sh",
        "ci-validate-texlive-base.sh",
        "ci-source-pipeline-e2e.sh",
      ]) {
        const result = spawnSync(
          "sh",
          [`deploy/scripts/${script}`, "base", "1"],
          {
            env: {
              ...process.env,
              GITHUB_ACTIONS: "true",
              RUNNER_ENVIRONMENT: "self-hosted",
            },
          },
        );
        expect(result.status).toBe(77);
      }
    },
  );

  it
    .skipIf(process.platform === "win32")
    .each(["", "1", "2", "4", "0", "3", "8", "20", "-1", "4\n", " 4"])(
    "validates and forwards the CI format worker setting %j before any mutation",
    (jobs) => {
      const root = mkdtempSync(join(tmpdir(), "renderer-ci-format-jobs-"));
      try {
        const trace = join(root, "trace");
        writeFileSync(trace, "");
        writeFileSync(
          join(root, "validate.sh"),
          readFileSync("deploy/scripts/ci-validate-texlive-base.sh"),
        );
        for (const name of [
          "smoke-test-texlive-base.sh",
          "ci-renderer-disk.sh",
          "build-language-runtime.sh",
          "smoke-test-renderer-basic.sh",
          "smoke-test-renderer-en-jp.sh",
          "smoke-test-renderer-svg.sh",
          "smoke-test-renderer-compat.sh",
          "ci-source-pipeline-e2e.sh",
        ]) {
          writeFileSync(
            join(root, name),
            `#!/bin/sh
echo '${name}' >> "$TEST_TRACE"
if [ '${name}' = build-language-runtime.sh ]; then
  [ "$RUNTIME_NO_CACHE" = true ] || exit 91
  [ "$RUNTIME_FORMAT_JOBS" = "$EXPECTED_JOBS" ] || exit 92
  printf 'format-jobs=%s\\n' "$RUNTIME_FORMAT_JOBS" >> "$TEST_TRACE"
fi
`,
            { mode: 0o700 },
          );
        }
        writeFileSync(
          join(root, "docker"),
          `#!/bin/sh
echo "docker $*" >> "$TEST_TRACE"
case "$*" in
  *Config.Labels*languages*) echo collection-langenglish,collection-langjapanese ;;
  *Config.Labels*runtime-kind*) echo managed-local-v1 ;;
esac
`,
          { mode: 0o700 },
        );
        const valid = ["", "1", "2", "4"].includes(jobs);
        const result = spawnSync(
          "sh",
          [
            join(root, "validate.sh"),
            "fixture-base",
            "https://example.test/tlnet",
          ],
          {
            encoding: "utf8",
            timeout: 5_000,
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              GITHUB_ACTIONS: "true",
              RUNNER_ENVIRONMENT: "github-hosted",
              GITHUB_RUN_ID: "123",
              GITHUB_RUN_ATTEMPT: "2",
              BUILDX_BUILDER: "default",
              CI_FORMAT_JOBS: jobs,
              EXPECTED_JOBS: jobs || "4",
              TEST_TRACE: trace,
            },
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status, result.stderr).toBe(valid ? 0 : 64);
        const commands = readFileSync(trace, "utf8");
        if (valid) {
          expect(commands).toContain(`format-jobs=${jobs || "4"}\n`);
          expect(commands).toContain("smoke-test-renderer-svg.sh");
          expect(commands).toContain("ci-source-pipeline-e2e.sh");
          expect(commands).toContain("docker image rm");
        } else {
          expect(commands).toBe("");
          expect(result.stderr).toContain("CI_FORMAT_JOBS must be 1, 2 or 4");
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it("uses the measured hosted default but keeps dispatch rollback and host serial defaults", () => {
    for (const name of ["renderer-image", "renderer-image-daily"]) {
      const workflow = readFileSync(`.github/workflows/${name}.yml`, "utf8");
      expect(workflow).toContain(
        "CI_FORMAT_JOBS: ${{ inputs.format_jobs || '4' }}",
      );
      expect(workflow).toMatch(/options: \["1", "2", "4"\]\s+default: "4"/);
    }
    expect(
      readFileSync("deploy/scripts/build-language-runtime.sh", "utf8"),
    ).toContain("format_jobs=${RUNTIME_FORMAT_JOBS:-1}");
  });

  it("isolates manual comparisons without removing normal cancellation or serializing publication differently", () => {
    const workflow = readFileSync(
      ".github/workflows/renderer-image.yml",
      "utf8",
    );
    const concurrency = workflow.slice(
      workflow.indexOf("\nconcurrency:"),
      workflow.indexOf("\njobs:"),
    );
    expect(concurrency).toContain(
      "group: renderer-image-${{ github.ref }}-${{ github.event_name == 'workflow_dispatch' && github.run_id || 'validation' }}",
    );
    expect(concurrency).toContain("cancel-in-progress: true");
    expect(workflow).not.toContain("packages: write");
    expect(workflow).toContain("push: false");
    const daily = readFileSync(
      ".github/workflows/renderer-image-daily.yml",
      "utf8",
    );
    expect(daily).toContain(
      "group: renderer-image-daily\n  cancel-in-progress: false",
    );
  });

  it("gates publication on fresh validation and anonymous verification", () => {
    const daily = readFileSync(
      ".github/workflows/renderer-image-daily.yml",
      "utf8",
    );
    const pr = readFileSync(".github/workflows/renderer-image.yml", "utf8");
    for (const workflow of [daily, pr]) {
      expect(workflow).toContain("ci-validate-texlive-base.sh");
      expect(workflow).not.toContain("cache-from:");
      expect(workflow).not.toContain("cache-to:");
    }
    expect(pr).toContain("file: renderer/Dockerfile.base");
    expect(pr).toContain("no-cache: true");
    expect(pr).not.toContain("packages: write");
    expect(daily).toContain('[[ "$base" == "$IMAGE_REPOSITORY@$digest" ]]');
    expect(daily).toContain(
      "GITHUB_TOKEN= node deploy/scripts/ghcr-tag-status.mjs",
    );
    expect(daily.indexOf("Verify anonymous pull")).toBeLessThan(
      daily.indexOf('--tag "$IMAGE_REPOSITORY:latest"'),
    );
    expect(daily).toContain(
      "steps.validate.outcome == 'success' && env.PUBLISH_REQUESTED == 'true'",
    );
  });
});
