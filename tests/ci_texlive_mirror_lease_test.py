import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "deploy/scripts/ci-texlive-mirror-lease.sh"


class LeaseHelperTests(unittest.TestCase):
    def test_access_credentials_stay_in_environment_and_proxy_is_required(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            capture = root / "ssh.json"
            attempts = root / "ssh-attempts"
            output = root / "github-output"
            (bin_dir / "cloudflared").write_text(
                "#!/bin/sh\nexit 0\n", encoding="utf-8"
            )
            (bin_dir / "sleep").write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            (bin_dir / "ssh").write_text(
                """#!/bin/sh
attempt=0
[ ! -f "$SSH_ATTEMPTS" ] || attempt=$(cat "$SSH_ATTEMPTS")
attempt=$((attempt + 1))
printf '%s\n' "$attempt" > "$SSH_ATTEMPTS"
if [ "$attempt" -le "${SSH_FAILURES:-2}" ]; then
  printf '%s' "${SSH_FAILED_OUTPUT:-partial-json}"
  exit 255
fi
if [ -n "${SSH_RESPONSE_OVERRIDE:-}" ]; then
  printf '%s' "$SSH_RESPONSE_OVERRIDE"
  exit 0
fi
python3 -c 'import json,os,sys; json.dump({"argv":sys.argv[1:],"id":os.environ.get("TUNNEL_SERVICE_TOKEN_ID"),"secret":os.environ.get("TUNNEL_SERVICE_TOKEN_SECRET")},open(os.environ["SSH_CAPTURE"],"w"))' "$@"
printf '%s\n' '{"canonicalDate":"2026-09-08","installerSha512":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","url":"https://texlive-ci.example.invalid/snapshots/tl2026-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-cccccccccccccccc-v2/tlnet","token":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","snapshotId":"tl2026-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-cccccccccccccccc-v2"}'
""",
                encoding="utf-8",
            )
            for executable in (
                bin_dir / "cloudflared",
                bin_dir / "sleep",
                bin_dir / "ssh",
            ):
                executable.chmod(0o755)

            access_id = "id-for-test.access"
            access_secret = "secret-for-test"
            environment = {
                **os.environ,
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "RUNNER_TEMP": temporary,
                "GITHUB_OUTPUT": str(output),
                "GITHUB_RUN_ID": "123",
                "GITHUB_RUN_ATTEMPT": "2",
                "GITHUB_JOB": "build",
                "TEXLIVE_CI_HOST": "texlive-ci-lease.example.invalid",
                "TEXLIVE_CI_USER": "texlive-ci-lease",
                "TEXLIVE_CI_SSH_KEY": "fake-private-key",
                "TEXLIVE_CI_KNOWN_HOSTS": "texlive-ci-lease.example.invalid ssh-ed25519 fake",
                "TEXLIVE_CI_ACCESS_CLIENT_ID": access_id,
                "TEXLIVE_CI_ACCESS_CLIENT_SECRET": access_secret,
                "TEXLIVE_CI_MIRROR_HOST": "texlive-ci.example.invalid",
                "SSH_CAPTURE": str(capture),
                "SSH_ATTEMPTS": str(attempts),
            }
            subprocess.run(
                [
                    "sh",
                    str(HELPER),
                    "acquire",
                    "2026-09-08",
                    "a" * 128,
                    "amd64",
                ],
                check=True,
                env=environment,
                text=True,
                capture_output=True,
            )

            invocation = json.loads(capture.read_text(encoding="utf-8"))
            self.assertEqual(attempts.read_text(encoding="utf-8").strip(), "3")
            self.assertEqual(invocation["id"], access_id)
            self.assertEqual(invocation["secret"], access_secret)
            arguments = invocation["argv"]
            self.assertIn(
                "ProxyCommand=cloudflared access ssh --hostname %h", arguments
            )
            self.assertNotIn(access_id, arguments)
            self.assertNotIn(access_secret, arguments)
            self.assertIn(
                "texlive-ci-lease@texlive-ci-lease.example.invalid", arguments
            )
            github_output = output.read_text(encoding="utf-8")
            self.assertIn("owner=123:2:build:amd64", github_output)
            self.assertIn(
                "snapshot_id=tl2026-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-cccccccccccccccc-v2",
                github_output,
            )

            mismatched_environment = {
                **environment,
                "GITHUB_OUTPUT": str(root / "mismatched-output"),
                "TEXLIVE_CI_MIRROR_HOST": "other-mirror.example.invalid",
            }
            mismatch = subprocess.run(
                [
                    "sh",
                    str(HELPER),
                    "acquire",
                    "2026-09-08",
                    "a" * 128,
                    "amd64",
                ],
                env=mismatched_environment,
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(mismatch.returncode, 0)
            self.assertIn("invalid reservation URL", mismatch.stderr)

            cases = [
                ("acquire", 0, "", None, True),
                ("acquire", 1, '{"partial":', None, True),
                ("acquire", 2, '{"completeButFailed":true}\n', None, True),
                ("acquire", 3, '{"partial":', None, False),
                ("acquire", 0, "", "not-json", False),
                ("acquire", 0, "", '{"canonicalDate":"wrong"}', False),
                ("release", 2, '{"partial":', '{"released":true}', True),
                ("release", 3, '{"partial":', None, False),
            ]
            for index, (
                operation,
                failures,
                failed_output,
                response,
                success,
            ) in enumerate(cases):
                with self.subTest(
                    operation=operation, failures=failures, response=response
                ):
                    attempts.unlink(missing_ok=True)
                    case_output = root / f"case-output-{index}"
                    case_env = {
                        **environment,
                        "GITHUB_OUTPUT": str(case_output),
                        "SSH_FAILURES": str(failures),
                        "SSH_FAILED_OUTPUT": failed_output,
                        "SSH_RESPONSE_OVERRIDE": response or "",
                    }
                    args = (
                        ["acquire", "2026-09-08", "a" * 128, "amd64"]
                        if operation == "acquire"
                        else ["release", "b" * 64, "123:2:build:amd64"]
                    )
                    result = subprocess.run(
                        ["sh", str(HELPER), *args],
                        env=case_env,
                        text=True,
                        capture_output=True,
                        timeout=10,
                    )
                    self.assertEqual(result.returncode == 0, success, result.stderr)
                    self.assertEqual(int(attempts.read_text()), min(failures + 1, 3))
                    if success and operation == "acquire":
                        self.assertEqual(
                            case_output.read_text().count("snapshot_id="), 1
                        )
                        self.assertEqual(result.stdout, "")
                    else:
                        self.assertFalse(case_output.exists())
                        self.assertEqual(result.stdout, response if success else "")
                    self.assertEqual(list(root.glob("texlive-ci-*")), [])

    def test_missing_access_credentials_fail_before_ssh(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            (bin_dir / "ssh").write_text("#!/bin/sh\nexit 99\n", encoding="utf-8")
            (bin_dir / "ssh").chmod(0o755)
            environment = {
                **os.environ,
                "PATH": f"{bin_dir}:{os.environ['PATH']}",
                "RUNNER_TEMP": temporary,
                "GITHUB_OUTPUT": str(root / "output"),
                "GITHUB_RUN_ID": "1",
                "GITHUB_RUN_ATTEMPT": "1",
                "GITHUB_JOB": "build",
                "TEXLIVE_CI_HOST": "texlive-ci-lease.example.invalid",
                "TEXLIVE_CI_SSH_KEY": "fake-private-key",
                "TEXLIVE_CI_KNOWN_HOSTS": "texlive-ci-lease.example.invalid ssh-ed25519 fake",
            }
            result = subprocess.run(
                ["sh", str(HELPER), "acquire", "2026-09-08", "a" * 128],
                env=environment,
                text=True,
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("TEXLIVE_CI_ACCESS_CLIENT_ID required", result.stderr)


if __name__ == "__main__":
    unittest.main()
