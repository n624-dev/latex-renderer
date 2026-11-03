"""Test only host-side control flow with fake commands; never start a container."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

PROBE = Path(__file__).with_name('probe.sh')
IMAGE = 'sha256:' + 'a' * 64
FAKE = '''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
args = sys.argv[1:]
assert args.pop(0) == '--remote=false'
assert 'CONTAINER_HOST' not in os.environ
with open(os.environ['TRACE'], 'a') as out: print(json.dumps(args), file=out)
if args[0] == 'info': print(os.environ.get('INFO', 'true v2'))
elif args[0] == 'run':
    src = next(a.split(',')[1][4:] for a in args if a.startswith('--mount='))
    assert 'Compact probe 4729' in (pathlib.Path(src) / 'main.tex').read_text()
    subprocess.run(['sh', '-n'], input=args[-1], text=True, check=True)
    pathlib.Path(args[args.index('--cidfile') + 1]).write_text('1' * 64)
    sys.exit(int(os.environ.get('RUN_RC', 0)))
elif args[:2] == ['container', 'exists']: sys.exit(int(os.environ.get('EXISTS', 1)))
elif args != ['rm', '--force', '--ignore', '1' * 64]: sys.exit(125)
'''


class ProbeTests(unittest.TestCase):
    def run_probe(self, image=IMAGE, **overrides):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for name, text in [('podman', FAKE), ('id', '#!/bin/sh\necho "$FAKE_UID"\n')]:
                path = root / name
                path.write_text(text)
                path.chmod(0o755)
            trace = root / 'trace'
            trace.touch()
            env = dict(os.environ, PATH=d + ':' + os.environ['PATH'], FAKE_UID='1000',
                       TRACE=str(trace), CONTAINER_HOST='invalid://must-not-be-used')
            result = subprocess.run(['sh', str(PROBE), image], env={**env, **overrides},
                                    capture_output=True, text=True, timeout=10)
            return result, [json.loads(s) for s in trace.read_text().splitlines()]

    def test_rejects_mutable_image(self):
        r, calls = self.run_probe('texlive:latest')
        self.assertNotEqual(r.returncode, 0); self.assertFalse(calls)

    def test_rejects_root(self):
        r, calls = self.run_probe(FAKE_UID='0')
        self.assertNotEqual(r.returncode, 0); self.assertFalse(calls)

    def test_refuses_unsupported_host(self):
        for info in ['false v2', 'true v1']:
            with self.subTest(info=info):
                r, calls = self.run_probe(INFO=info)
                self.assertNotEqual(r.returncode, 0); self.assertEqual(len(calls), 1)

    def test_local_only_and_bounded_with_private_fixture(self):
        r, calls = self.run_probe()
        self.assertEqual(r.returncode, 0, r.stderr)
        args = calls[1]
        for flag in ['--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
                     '--user=10000:10000', '--pids-limit=128', '--memory=1g', '--memory-swap=1g',
                     '--security-opt=no-new-privileges', '--timeout=180', '--cpus=1.5']:
            self.assertIn(flag, args)
        mounts = [a for a in args if a.startswith('--mount=')]
        self.assertIn('--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=256m,mode=1777', args)
        self.assertIn('--tmpfs=/work/output:rw,noexec,nosuid,nodev,size=64m,mode=1777', args)
        self.assertEqual(len(mounts), 1); self.assertTrue(mounts[0].endswith('dst=/work/input,ro'))
        self.assertFalse(Path(mounts[0].split(',')[1][4:]).exists())
        self.assertIn(IMAGE[7:], args); self.assertEqual(calls[-1][:2], ['container', 'exists'])

    def test_render_failure_still_cleans_up(self):
        r, calls = self.run_probe(RUN_RC='42')
        self.assertEqual(r.returncode, 42); self.assertEqual(calls[-2][0], 'rm')
        self.assertNotIn('passed', r.stdout)

    def test_cleanup_not_assumed(self):
        for code in ['0', '125']:
            with self.subTest(code=code):
                r, _ = self.run_probe(EXISTS=code)
                self.assertNotEqual(r.returncode, 0); self.assertNotIn('passed', r.stdout)


if __name__ == '__main__':
    unittest.main()
