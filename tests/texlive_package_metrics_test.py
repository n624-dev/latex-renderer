"""Upstream-call measurement contracts; no downloads or TeX installation."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PREFIX = "TEXLIVE_PACKAGE_METRICS "
PROGRAM = r'''
BEGIN {
    package FalseException;
    use overload 'bool' => sub { 0 }, '""' => sub { 'synthetic exception' };
    package TeXLive::TLConfig;
    our $DefaultCompressorFormat = 'xz';
    package FixtureDb;
    sub root { 'https://example.invalid/tlnet' }
    sub get_package { bless {}, 'FixturePackage' }
    package FixturePackage;
    sub containersize { 12 }
    sub containerchecksum { '1' x 128 }
    package TeXLive::TLUtils;
    sub download_file { die 'unexpected download' }
    sub check_file_and_remove {
        die $::exception if $ENV{MODE} =~ /exception/;
        die 'arguments changed' unless join(',', @_) eq 'synthetic-private-url,hash,12';
        $_[2]++ if $ENV{MODE} eq 'alias';
        return 'checksum-return';
    }
    sub system_pipe {
        my $context = wantarray;
        push @::contexts, defined($context) ? ($context ? 'list' : 'scalar') : 'void';
        # Exercise CPU in a waited descendant, as xz does upstream.
        # CPU duration rather than iteration count survives faster hosted CPUs
        # and the coarse clock ticks used by Perl times(). No wall-speed claim.
        system($^X, '-e', 'use Time::HiRes qw(clock_gettime CLOCK_PROCESS_CPUTIME_ID); my $start = clock_gettime(CLOCK_PROCESS_CPUTIME_ID); 1 while clock_gettime(CLOCK_PROCESS_CPUTIME_ID) - $start < 0.03') == 0 or die;
        return ('first', 'second') if $context;
        return 37;
    }
    sub untar {
        if ($ENV{MODE} eq 'fork') {
            my $pid = fork();
            die 'fork failed' unless defined $pid;
            if (!$pid) {
                check_file_and_remove('synthetic-private-url', 'hash', 12);
                require POSIX;
                POSIX::_exit(0);
            }
            waitpid($pid, 0);
            die 'child failed' if $?;
        }
        select undef, undef, undef, 0.02;
        return 0; # Failed upstream result must never be turned into success.
    }
    sub install_packages {
        my $context = wantarray;
        $@ = 'prior-eval-error';
        my $size = 12;
        die 'checksum result changed' unless check_file_and_remove('synthetic-private-url', 'hash', $size) eq 'checksum-return';
        die 'argument alias lost' if $ENV{MODE} eq 'alias' && $size != 13;
        die 'prior error lost' unless $@ eq 'prior-eval-error';
        my @values = system_pipe('decompress');
        die 'list changed' unless join(',', @values) eq 'first,second';
        die 'scalar changed' unless scalar(system_pipe('decompress')) == 37;
        system_pipe('decompress');
        die 'context changed' unless join(',', @::contexts) eq 'list,scalar,void';
        die 'failure hidden' unless $ENV{MODE} eq 'missing-skip' || untar('archive', 'target') == 0;
        return ('package', 9) if $context;
        return 19;
    }
    undef *untar if $ENV{MODE} =~ /^missing/;
    $INC{'TeXLive/TLUtils.pm'} = 1;
}
use TeXLivePrefetch;
use Scalar::Util qw(refaddr);
$::exception = bless {}, 'FalseException';
if ($ENV{MODE} eq 'outside') {
    TeXLive::TLUtils::check_file_and_remove('synthetic-private-url', 'hash', 12);
    exit;
}
my $context = $ENV{MODE};
my @args = (bless({}, 'FixtureDb'), 'NET', undef, ['fixture'], 0, 0);
my $ok = eval {
    if ($context eq 'list') {
        my @result = TeXLive::TLUtils::install_packages(@args);
        die 'install list changed' unless join(',', @result) eq 'package,9';
    } elsif ($context eq 'void') {
        TeXLive::TLUtils::install_packages(@args);
    } else {
        die 'install scalar changed' unless TeXLive::TLUtils::install_packages(@args) == 19;
    }
    1;
};
if (!$ok) {
    die 'exception identity changed' if $context =~ /exception/ && refaddr($@) != refaddr($::exception);
    exit 7;
}
'''


class PackageMetricsTests(unittest.TestCase):
    def run_fixture(self, mode):
        with tempfile.TemporaryDirectory() as temporary:
            result = subprocess.run(
                ["perl", "-I", str(ROOT / "renderer"), "-e", PROGRAM],
                text=True, capture_output=True, timeout=10,
                env=dict(os.environ, MODE=mode,
                         TEXLIVE_PREFETCH_WORKERS="2" if mode.startswith("prefetch") else "0",
                         TMPDIR=temporary),
            )
            self.assertEqual(list(Path(temporary).iterdir()), [])
        reports = [json.loads(line[len(PREFIX):]) for line in result.stdout.splitlines()
                   if line.startswith(PREFIX)]
        self.assertNotIn("synthetic-private-url", result.stdout)
        self.assertNotIn("synthetic exception", result.stdout)
        self.assertTrue(all(len(line) < 1024 for line in result.stdout.splitlines()
                            if line.startswith(PREFIX)))
        return result, reports

    def test_scalar_list_void_and_failure_return_are_preserved(self):
        for mode in ("scalar", "list", "void", "prefetch", "fork", "alias"):
            with self.subTest(mode=mode):
                result, reports = self.run_fixture(mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(len(reports), 1)
                report = reports[0]
                self.assertEqual(report["schema"], 1)
                self.assertEqual(report["returned"], 1)
                self.assertGreater(report["elapsed_seconds"], 0)
                self.assertGreaterEqual(report["cpu_seconds"], 0)
                self.assertEqual(report["stages"]["checksum"]["calls"], 1)
                self.assertEqual(report["stages"]["decompress"]["calls"], 3)
                self.assertGreater(report["stages"]["decompress"]["cpu_seconds"], 0)
                self.assertEqual(report["stages"]["extract"]["calls"], 1)
                self.assertGreaterEqual(report["stages"]["extract"]["elapsed_seconds"], 0.019)
                self.assertEqual(report["stages"]["extract"]["exceptions"], 0)

    def test_false_exception_object_is_rethrown_with_partial_measurement(self):
        for mode in ("exception", "prefetch-exception"):
            with self.subTest(mode=mode):
                result, reports = self.run_fixture(mode)
                self.assertEqual(result.returncode, 7, result.stderr)
                self.assertNotIn("exception identity changed", result.stderr)
                self.assertEqual(reports[0]["returned"], 0)
                self.assertEqual(reports[0]["stages"]["checksum"]["exceptions"], 1)
                self.assertEqual(reports[0]["stages"]["decompress"]["calls"], 0)

    def test_metadata_outside_package_install_is_not_measured(self):
        result, reports = self.run_fixture("outside")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(reports, [])

    def test_missing_future_helper_is_null_not_zero(self):
        for mode, status in (("missing", 7), ("missing-skip", 0)):
            with self.subTest(mode=mode):
                result, reports = self.run_fixture(mode)
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertIsNone(reports[0]["stages"]["extract"])


if __name__ == "__main__":
    unittest.main()
