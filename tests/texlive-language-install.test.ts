import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.each(["healthy", "missing-dependency", "missing-file", "permanent", "download-error"])(
  "validates and bounds language installation recovery: %s",
  (scenario) => {
    const root = mkdtempSync(join(tmpdir(), "language-install-"));
    try {
      writeFileSync(join(root, "tlmgr"), `#!/bin/sh
echo "$*" >> "$TEST_ROOT/trace"
if [ "$1" = install ]; then
  if [ "$2" = --reinstall ]; then touch "$TEST_ROOT/retried"; fi
  if [ "$SCENARIO" = download-error ] && [ ! -e "$TEST_ROOT/retried" ]; then exit 1; fi
  exit 0
fi
if [ "$SCENARIO" = permanent ]; then exit 1; fi
if [ ! -e "$TEST_ROOT/retried" ]; then
  if [ "$SCENARIO:$2" = missing-dependency:depends ]; then exit 1; fi
  if [ "$SCENARIO:$2" = missing-file:files ]; then exit 1; fi
fi
exit 0
`, { mode: 0o755 });
      const result = spawnSync("sh", ["renderer/install-language-packages.sh", "collection-langenglish", "collection-langjapanese"], {
        env: { ...process.env, PATH: `${root}:${process.env.PATH}`, TEST_ROOT: root, SCENARIO: scenario },
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(scenario === "permanent" ? 65 : 0);
      const lines = readFileSync(join(root, "trace"), "utf8").trim().split("\n");
      expect(lines.filter((line) => line.startsWith("install "))).toHaveLength(scenario === "healthy" ? 1 : 2);
      if (scenario !== "healthy") {
        expect(lines).toContain("install --reinstall collection-langenglish collection-langjapanese");
      }
      if (scenario !== "permanent") expect(lines.slice(-2)).toEqual(["check depends", "check files"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
