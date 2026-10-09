"""Small, unprivileged fixtures: never execute host APT or systemctl."""

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


REPO = Path(__file__).resolve().parents[1]


@unittest.skipUnless(shutil.which("sh") and shutil.which("dpkg"), "Debian shell fixture")
class StableCloudflaredUpdateTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cloudflared-update-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.trace = self.root / "trace"
        self.trace.write_text("")
        self.installed = self.root / "installed"
        self.installed.write_text("2026.9.3")
        self.key = self.root / "key.gpg"
        self.key.write_text("fixture: APT itself verifies the real signature")
        self.key.chmod(0o644)
        self.source = self.root / "cloudflared.list"
        self.stable = (REPO / "deploy/apt/cloudflared.list").read_text().replace(
            "/usr/share/keyrings/cloudflare-main.gpg", str(self.key)
        )
        self.source.write_text(self.stable)
        self.source.chmod(0o644)
        body = (REPO / "deploy/scripts/cloudflared-update.sh").read_text()
        body = body.replace("/etc/apt/sources.list.d/cloudflared.list", str(self.source))
        body = body.replace("/usr/share/keyrings/cloudflare-main.gpg", str(self.key))
        self.script = self.root / "update.sh"
        self.script.write_text(body)
        self.mock("id", 'printf "%s\\n" "${TEST_UID:-0}"')
        # Only the fixture owner is mocked; permissions and symlinks are real.
        self.mock("stat", '''
if [ "$2" = %u ]; then printf '%s\\n' "${TEST_OWNER:-0}";
else exec /usr/bin/stat "$@"; fi
''')
        self.mock("dpkg-query", 'cat "$TEST_ROOT/installed"')
        self.mock("apt-cache", '''
printf 'apt-cache %s\\n' "$*" >> "$TEST_ROOT/trace"
printf 'cloudflared:\\n  Candidate: %s\\n' "${TEST_CANDIDATE-2026.9.4}"
''')
        self.mock("apt-get", '''
printf 'apt-get %s\\n' "$*" >> "$TEST_ROOT/trace"
case " $* " in
  *" update "*) exit "${TEST_UPDATE_EXIT:-0}" ;;
  *" --simulate "*)
    printf 'Inst %s [%s] (%s Stable)\\n' "${TEST_PLAN_PACKAGE:-cloudflared}" \
      2026.9.3 "${TEST_CANDIDATE:-2026.9.4}"
    if [ "${TEST_REMOVE:-}" = yes ]; then printf 'Remv unrelated [1]\\n'; fi
    ;;
  *" install "*)
    [ "${TEST_INSTALL_EXIT:-0}" = 0 ] || exit "$TEST_INSTALL_EXIT"
    printf '%s' "${TEST_AFTER:-${TEST_CANDIDATE:-2026.9.4}}" > "$TEST_ROOT/installed"
    ;;
  *) exit 99 ;;
esac
''')
        self.mock("systemctl", '''
printf 'systemctl %s\\n' "$*" >> "$TEST_ROOT/trace"
exit "${TEST_SYSTEMCTL_EXIT:-0}"
''')
        self.mock("cloudflared", '''
printf 'cloudflared %s\\n' "$*" >> "$TEST_ROOT/trace"
printf 'cloudflared version fixture\\n'
''')

    def mock(self, name, body):
        file = self.bin / name
        file.write_text("#!/bin/sh\nset -eu\n" + body + "\n")
        file.chmod(0o700)

    def run_update(self, **env):
        return subprocess.run(
            ["sh", str(self.script)],
            env={**os.environ, "PATH": f"{self.bin}:/usr/bin:/bin",
                 "TEST_ROOT": str(self.root), **env},
            capture_output=True, text=True, timeout=5, check=False,
        )

    def test_upgrades_only_stable_and_restarts_after_success(self):
        result = self.run_update()
        self.assertEqual(result.returncode, 0, result.stderr)
        lines = self.trace.read_text().splitlines()
        apt = [line for line in lines if line.startswith(("apt-get ", "apt-cache "))]
        self.assertEqual(len(apt), 4)
        for line in apt:
            for option in ["Dir::Etc::sourceparts=-", "Dir::Cache::pkgcache=",
                           "Dir::Cache::srcpkgcache=", "APT::Get::List-Cleanup=0",
                           "APT::Get::AllowUnauthenticated=false",
                           "Acquire::AllowInsecureRepositories=false",
                           "Acquire::AllowDowngradeToInsecureRepositories=false",
                           "Dir::Etc::sourcelist=sources.list.d/cloudflared.list",
                           "Acquire::Retries=3", "Acquire::https::Timeout=60"]:
                self.assertIn(option, line)
            self.assertNotIn("allow-unauthenticated", line)
            self.assertNotIn("allow-insecure", line)
        self.assertIn("update --error-on=any", apt[0])
        self.assertIn("--simulate", apt[2])
        self.assertIn("--only-upgrade --no-install-recommends --no-remove --yes cloudflared=2026.9.4", apt[3])
        self.assertLess(lines.index(apt[3]), lines.index("systemctl restart cloudflared.service"))
        self.assertIn("systemctl is-active --quiet cloudflared.service", lines)

    def test_current_stable_does_not_install_or_restart(self):
        result = self.run_update(TEST_CANDIDATE="2026.9.3")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn(" install ", self.trace.read_text())
        self.assertNotIn(" restart ", self.trace.read_text())
        self.assertIn("is-active", self.trace.read_text())

    def test_rejects_non_root_before_apt(self):
        self.assertEqual(self.run_update(TEST_UID="1000").returncode, 77)
        self.assertEqual(self.trace.read_text(), "")

    def test_rejects_uncontrolled_file_before_apt(self):
        self.assertEqual(self.run_update(TEST_OWNER="1000").returncode, 78)
        self.assertEqual(self.trace.read_text(), "")

    def test_rejects_missing_source(self):
        self.source.unlink()
        self.assertEqual(self.run_update().returncode, 78)
        self.assertEqual(self.trace.read_text(), "")

    def test_rejects_symlinks_and_writable_source_or_key(self):
        for file in [self.source, self.key]:
            original = file.read_text()
            target = self.root / (file.name + ".target")
            target.write_text(original)
            file.unlink()
            file.symlink_to(target)
            self.assertEqual(self.run_update().returncode, 78)
            file.unlink()
            file.write_text(original)
            file.chmod(0o664)
            self.assertEqual(self.run_update().returncode, 78)
            file.chmod(0o644)
        self.assertEqual(self.trace.read_text(), "")

    def test_rejects_nightly_unsigned_extra_or_disabled_sources(self):
        for source in [
            self.stable.replace("https://pkg.", "https://next.pkg."),
            self.stable.replace("deb [", "deb [trusted=yes "),
            self.stable + self.stable,
            self.stable + "deb https://example.invalid any main\n",
            "# " + self.stable,
        ]:
            self.source.write_text(source)
            self.assertEqual(self.run_update().returncode, 78, source)
        self.assertEqual(self.trace.read_text(), "")

    def test_accepts_comments_and_blank_lines(self):
        self.source.write_text("# official Stable only\n\n" + self.stable + "\n")
        self.assertEqual(self.run_update().returncode, 0)

    def test_rejects_prerelease_missing_or_ambiguous_candidates(self):
        for version in ["2026.9.4-beta", "2026.9.4-rc.1", "2026.9.4-nightly",
                        "(none)", "", "2026.9.4\n  Candidate: 2026.10.0"]:
            self.trace.write_text("")
            result = self.run_update(TEST_CANDIDATE=version)
            self.assertEqual(result.returncode, 78, version)
            self.assertNotIn(" install ", self.trace.read_text())

    def test_refuses_downgrade(self):
        self.assertEqual(self.run_update(TEST_CANDIDATE="2026.9.2").returncode, 78)
        self.assertNotIn(" install ", self.trace.read_text())

    def test_refresh_failure_never_uses_stale_indexes(self):
        self.assertEqual(self.run_update(TEST_UPDATE_EXIT="100").returncode, 100)
        self.assertNotIn("apt-cache", self.trace.read_text())
        self.assertNotIn("systemctl", self.trace.read_text())

    def test_refuses_simulated_changes_to_other_packages(self):
        for env in [{"TEST_PLAN_PACKAGE": "unrelated"}, {"TEST_REMOVE": "yes"}]:
            self.trace.write_text("")
            self.assertEqual(self.run_update(**env).returncode, 78)
            lines = self.trace.read_text().splitlines()
            self.assertFalse(any(" install " in line and "--simulate" not in line for line in lines))
            self.assertNotIn("systemctl", self.trace.read_text())

    def test_failed_install_does_not_restart(self):
        self.assertEqual(self.run_update(TEST_INSTALL_EXIT="100").returncode, 100)
        self.assertNotIn("systemctl", self.trace.read_text())
        self.assertEqual(self.installed.read_text(), "2026.9.3")

    def test_installed_version_mismatch_and_inactive_tunnel_are_failures(self):
        self.assertEqual(self.run_update(TEST_AFTER="2026.9.3").returncode, 1)
        self.assertNotIn("systemctl", self.trace.read_text())
        self.assertEqual(self.run_update(TEST_SYSTEMCTL_EXIT="3").returncode, 3)


if __name__ == "__main__":
    unittest.main()
