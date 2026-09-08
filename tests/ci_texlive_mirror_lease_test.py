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
            output = root / "github-output"
            (bin_dir / "cloudflared").write_text(
                "#!/bin/sh\nexit 0\n", encoding="utf-8"
            )
            (bin_dir / "ssh").write_text(
                """#!/bin/sh
python3 -c 'import json,os,sys; json.dump({"argv":sys.argv[1:],"id":os.environ.get("TUNNEL_SERVICE_TOKEN_ID"),"secret":os.environ.get("TUNNEL_SERVICE_TOKEN_SECRET")},open(os.environ["SSH_CAPTURE"],"w"))' "$@"
printf '%s\n' '{"canonicalDate":"2026-09-08","installerSha512":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","url":"https://texlive-ci.example.invalid/snapshots/tl2026-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-cccccccccccccccc-v2/tlnet","token":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","snapshotId":"tl2026-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-cccccccccccccccc-v2"}'
""",
                encoding="utf-8",
            )
            for executable in (bin_dir / "cloudflared", bin_dir / "ssh"):
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
                "SSH_CAPTURE": str(capture),
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
            self.assertEqual(invocation["id"], access_id)
            self.assertEqual(invocation["secret"], access_secret)
            arguments = invocation["argv"]
            self.assertIn(
                "ProxyCommand=cloudflared access ssh --hostname %h", arguments
            )
            self.assertNotIn(access_id, arguments)
            self.assertNotIn(access_secret, arguments)
            self.assertIn("texlive-ci-lease@texlive-ci-lease.example.invalid", arguments)
            github_output = output.read_text(encoding="utf-8")
            self.assertIn("owner=123:2:build:amd64", github_output)
            self.assertIn(
                "snapshot_id=tl2026-aaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-cccccccccccccccc-v2",
                github_output,
            )

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
