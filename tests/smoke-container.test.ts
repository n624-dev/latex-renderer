import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("smoke container output isolation", () => {
  it
    .skipIf(process.platform === "win32")
    .each(["", "init", "create", "start", "copy"])(
    "cleans up resources after success or failure at %s",
    (failure) => {
      const root = mkdtempSync(join(tmpdir(), "renderer-smoke-test-"));
      try {
        const trace = join(root, "trace");
        writeFileSync(
          join(root, "docker"),
          `#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_TRACE"
case "$1 $2" in
  'volume create') printf '%064d\\n' 1 ;;
  'run --rm') [ "$FAIL_STAGE" != init ] || exit 59 ;;
  'create --name') [ "$FAIL_STAGE" != create ] || exit 59 ;;
  'start --attach') [ "$FAIL_STAGE" != start ] || exit 59 ;;
  cp*) [ "$FAIL_STAGE" != copy ] || exit 59 ;;
esac
exit 0
`,
          { mode: 0o700 },
        );
        const result = spawnSync(
          "sh",
          [
            "-c",
            '. "$1"; run_smoke_container test-image "$2" --network none --read-only --cap-drop ALL test-image',
            "smoke-test",
            "deploy/scripts/smoke-container.sh",
            root,
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${root}:${process.env.PATH}`,
              TEST_TRACE: trace,
              FAIL_STAGE: failure,
            },
          },
        );
        expect(result.status, result.stderr).toBe(
          failure === "copy" ? 1 : failure ? 59 : 0,
        );
        const commands = readFileSync(trace, "utf8");
        expect(commands).toContain("volume rm ");
        expect(commands).toContain(
          "container rm --force latex-renderer-smoke-",
        );
        expect(commands).toContain(
          "--user 0:0 --cap-drop ALL --cap-add CHOWN --cap-add FOWNER",
        );
        expect(commands).not.toContain("--privileged");
        expect(commands).not.toContain("type=bind");
        if (failure !== "init")
          expect(commands).toContain("--user 10000:10000");
        if (!failure || failure === "start" || failure === "copy")
          expect(commands).toContain("cp latex-renderer-smoke-");
        if (failure === "init" || failure === "create")
          expect(commands).not.toContain("start --attach");
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
  it.each(["renderer-basic", "renderer-en-jp", "renderer-svg", "texlive-base"])(
    "%s uses isolated output and retains rendering restrictions",
    (kind) => {
      const script = readFileSync(
        `deploy/scripts/smoke-test-${kind}.sh`,
        "utf8",
      );
      expect(script).toContain('run_smoke_container "$image" "$output"');
      expect(script).not.toContain('--user "$(id -u):$(id -g)"');
      expect(script).not.toContain("src=$output,dst=/work/output");
      for (const flag of [
        "--network none",
        "--read-only",
        "--cap-drop ALL",
        "--pids-limit",
        "--security-opt",
      ])
        expect(script).toContain(flag);
    },
  );
});
