import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Source pipeline CI fail-closed contract", () => {
  it.skipIf(process.platform === "win32").each([
    ["", 0],
    ["node", 87],
    ["image", 65],
    ["install", 52],
    ["build", 53],
    ["vitest", 54],
  ] as const)(
    "propagates %s failure without falling back to the deterministic child",
    (failure, expected) => {
      const root = mkdtempSync(join(tmpdir(), "source-pipeline-ci-"));
      try {
        mkdirSync(join(root, "deploy/scripts"), { recursive: true });
        writeFileSync(
          join(root, "deploy/scripts/ci-source-pipeline-e2e.sh"),
          readFileSync("deploy/scripts/ci-source-pipeline-e2e.sh"),
        );
        writeFileSync(
          join(root, "deploy/scripts/ci-renderer-disk.sh"),
          '#!/bin/sh\necho "disk $*" >> "$TEST_TRACE"\n',
        );
        writeFileSync(
          join(root, "node"),
          '#!/bin/sh\necho node >> "$TEST_TRACE"\n[ "$TEST_FAILURE" != node ] || exit 87\n',
          { mode: 0o700 },
        );
        writeFileSync(
          join(root, "docker"),
          '#!/bin/sh\necho "docker $*" >> "$TEST_TRACE"\nif [ "$TEST_FAILURE" = image ]; then echo mutable:tag; else printf "sha256:%064d\\n" 0; fi\n',
          { mode: 0o700 },
        );
        writeFileSync(
          join(root, "corepack"),
          '#!/bin/sh\necho "corepack $*" >> "$TEST_TRACE"\ncase "$*" in\n "pnpm install --frozen-lockfile") [ "$TEST_FAILURE" != install ] || exit 52 ;;\n "pnpm --filter "*) [ "$TEST_FAILURE" != build ] || exit 53 ;;\n "pnpm exec vitest run --config vitest.source-pipeline.config.ts") [ -n "$SOURCE_PIPELINE_RENDERER_IMAGE" ] || exit 88; [ "$TEST_FAILURE" != vitest ] || exit 54 ;;\n *) exit 89 ;;\nesac\n',
          { mode: 0o700 },
        );
        const trace = join(root, "trace");
        const result = spawnSync(
          "sh",
          ["deploy/scripts/ci-source-pipeline-e2e.sh", "fixture-runtime"],
          {
            cwd: root,
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              GITHUB_ACTIONS: "true",
              RUNNER_ENVIRONMENT: "github-hosted",
              TEST_TRACE: trace,
              TEST_FAILURE: failure,
            },
          },
        );
        expect(result.status, result.stderr).toBe(expected);
        const commands = readFileSync(trace, "utf8");
        expect(commands).not.toMatch(/docker (pull|push|build|run)/);
        if (["node", "image"].includes(failure))
          expect(commands).not.toContain("corepack");
        if (failure === "install") expect(commands).not.toContain("--filter");
        if (failure === "build") expect(commands).not.toContain("vitest run");
        if (!failure) {
          expect(commands).toContain(
            "docker image inspect fixture-runtime --format {{.Id}}",
          );
          expect(commands).toContain("disk before-source-pipeline-e2e 1");
          expect(commands).toContain("pnpm install --frozen-lockfile");
          expect(commands).toContain(
            "vitest run --config vitest.source-pipeline.config.ts",
          );
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
