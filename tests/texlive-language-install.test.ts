import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it.each(["healthy", "missing-collection", "missing-dependency", "missing-file", "permanent", "download-error"])(
  "validates and bounds language installation recovery: %s",
  (scenario) => {
    const root = mkdtempSync(join(tmpdir(), "language-install-"));
    try {
      mkdirSync(join(root, "tlpkg/TeXLive"), { recursive: true });
      writeFileSync(join(root, "kpsewhich"), '#!/bin/sh\nprintf "%s\\n" "$TEST_ROOT"\n', { mode: 0o755 });
      writeFileSync(join(root, "tlpkg/TeXLive/TLPDB.pm"), `package TeXLive::TLPDB;
sub new { bless {}, shift }
sub list_packages { my $self = shift; grep { $self->get_package($_) } ('collection-langenglish', 'collection-langjapanese', 'standalone-font', 'haranoaji') }
sub get_package {
  my ($self, $name) = @_;
  if ($name eq 'collection-langjapanese' && $ENV{SCENARIO} eq 'missing-collection' && !-e "$ENV{TEST_ROOT}/retried") { return undef; }
  if ($name eq 'haranoaji' && ($ENV{SCENARIO} eq 'permanent' || ($ENV{SCENARIO} eq 'missing-dependency' && !-e "$ENV{TEST_ROOT}/retried"))) { return undef; }
  return bless {name=>$name}, 'FixturePackage';
}
package FixturePackage;
sub depends { $_[0]{name} eq 'collection-langjapanese' ? ('haranoaji', 'optional.ARCH') : () }
1;
`);
      writeFileSync(join(root, "tlmgr"), `#!/bin/sh
echo "$*" >> "$TEST_ROOT/trace"
if [ "$1" = install ]; then
  if [ "$2" = --reinstall ]; then touch "$TEST_ROOT/retried"; fi
  if [ "$SCENARIO" = download-error ] && [ ! -e "$TEST_ROOT/retried" ]; then exit 1; fi
  exit 0
fi
if [ ! -e "$TEST_ROOT/retried" ]; then
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
      if (scenario !== "permanent") expect(lines.at(-1)).toBe("check files");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
