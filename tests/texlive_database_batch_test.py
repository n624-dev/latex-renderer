"""Disposable local DB save contracts; no TeX archive downloads or installs."""
import hashlib
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
PREFIX = "TEXLIVE_DATABASE_SAVES "
PROGRAM = r'''
BEGIN {
    package FixtureException;
    use overload 'bool' => sub { 0 }, '""' => sub { 'synthetic exception' };
    package FixturePackage;
    sub postactions { $_[0]{action} ? ('script fixture') : () }
    sub containersize { 12 }
    sub containerchecksum { '1' x 128 }
    package TeXLive::TLConfig;
    our $DefaultCompressorFormat = 'xz';
    package TeXLive::TLPDB;
    our $description;
    format FixtureDescription =
longdesc ^<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<~~
$description
.
    sub root { $_[0]{root} }
    sub location { $_[0]{root} . '/tlpkg/texlive.tlpdb' }
    sub is_virtual { $ENV{MODE} eq 'virtual' }
    sub get_package { bless {}, 'FixturePackage' }
    sub writeout {
        my ($self, $fd) = @_;
        for my $name (sort keys %{$self->{packages}}) {
            print $fd "name $name\n", $self->{packages}{$name}, "\n\n";
            if ($ENV{MODE} eq 'format') {
                $description = 'A long package description with wrapped words. ' x 20;
                select((select($fd), $~ = 'TeXLive::TLPDB::FixtureDescription')[0]);
                $fd->format_lines_per_page(99999);
                write $fd;
            }
        }
    }
    sub save {
        my $self = shift;
        die $::exception if $ENV{MODE} eq 'save-exception';
        die "ENOSPC fixture\n" if $ENV{MODE} eq 'enospc';
        return 0 if $ENV{MODE} eq 'save-false';
        open my $trace, '>>', "$ENV{TMPDIR}/trace" or die;
        print $trace "$self->{kind} ", scalar(keys %{$self->{packages}}), "\n";
        close $trace or die;
        my $path = $self->location;
        open my $out, '>', "$path.tmp" or die;
        $self->writeout($out);
        close $out or die;
        require File::Copy;
        File::Copy::copy("$path.tmp", $path) or die;
        unlink "$path.tmp" or die;
        if ($ENV{MODE} eq 'truncate') {
            open my $bad, '>', $path or die;
            print $bad 'truncated';
            close $bad or die;
        }
        return 1;
    }
    package TeXLive::TLUtils;
    sub download_file { die 'unexpected download' }
    sub do_postaction {
        my ($how, $package) = @_;
        if ($package->{action}) {
            open my $in, '<', $::target->location or die 'postaction DB missing';
            my $actual = do { local $/; <$in> };
            close $in;
            my $expected = '';
            open my $sink, '>', \$expected or die;
            $::target->writeout($sink);
            close $sink or die;
            die 'postaction saw stale DB' unless $actual eq $expected;
            die $::exception if $ENV{MODE} eq 'post-exception';
        }
        return 1;
    }
    sub install_packages {
        my ($source, $media, $target, $packages) = @_;
        my $context = wantarray;
        return 1 if $ENV{MODE} eq 'missing';
        $source->save if $ENV{MODE} eq 'source';
        my $i = 0;
        for my $name (@$packages) {
            $target->{packages}{$name} = 'payload=' . ('x' x ($ENV{PAYLOAD_BYTES} // 64));
            $target->{packages}{$name} .= chr(0x65E5) . chr(0x672C) . chr(0x8A9E) if $ENV{MODE} eq 'unicode';
            if ($ENV{MODE} eq 'latin1') {
                $target->{packages}{$name} .= chr(233);
                utf8::upgrade($target->{packages}{$name});
            }
            $target->save;
            $i++;
            $target->save('unexpected') if $ENV{MODE} eq 'save-args' && $i == 1;
            TeXLive::TLUtils::install_packages($source, $media, $target, [], 0, 0)
                if $ENV{MODE} eq 'nested' && $i == 1;
            if ($ENV{MODE} eq 'kill' && $i == 70) {
                print "checkpoint-ready\n";
                STDOUT->autoflush(1);
                sleep 100;
            }
            die $::exception if $ENV{MODE} eq 'install-exception' && $i == 5;
            my $action = ($ENV{MODE} eq 'post' || $ENV{MODE} eq 'post-exception') && $i % 7 == 0;
            my $package = bless {action => $action}, 'FixturePackage';
            do_postaction('install', $package, 0, 0, 0, 1);
            return 0 if $ENV{MODE} eq 'install-false' && $i == 5;
        }
        $target->save; # Standard install_packages' final checkpoint.
        return ('installed', scalar(@$packages)) if $context;
        return 1;
    }
    undef *TeXLive::TLPDB::save if $ENV{MODE} eq 'missing';
    undef *TeXLive::TLUtils::do_postaction if $ENV{MODE} eq 'missing-post';
    $INC{'TeXLive/TLUtils.pm'} = 1;
    $0 = 'install-tl' unless $ENV{MODE} eq 'wrong-program';
    require TeXLivePrefetch if $ENV{MODE} eq 'wrong-order';
}
use IO::Handle ();
use TeXLiveDatabaseBatch;
if ($ENV{MODE} eq 'verify-enospc') {
    no warnings 'redefine';
    *File::Temp::new = sub { die "ENOSPC verification fixture\n" };
}
if ($ENV{MODE} eq 'verify-write-enospc') {
    no warnings 'redefine';
    *File::Temp::new = sub { open my $out, '>', '/dev/full' or die; return $out; };
}
require TeXLivePrefetch if $ENV{CHAIN};
@ARGV = () if $ENV{MODE} eq 'consume-args'; # install-tl's GetOptions consumes flags.
use Scalar::Util qw(refaddr);
$::exception = bless {}, 'FixtureException';
my $root = "$ENV{TMPDIR}/target";
my $source_root = "$ENV{TMPDIR}/source";
mkdir $root or die; mkdir "$root/tlpkg" or die;
mkdir $source_root or die; mkdir "$source_root/tlpkg" or die;
my $source = bless {root => $source_root, packages => {original => 'signed-fixture'}, kind => 'source'}, 'TeXLive::TLPDB';
$::target = bless {root => $root, packages => {}, kind => 'target'}, 'TeXLive::TLPDB';
my @packages = map { sprintf 'pkg%04d', $_ } 1 .. ($ENV{COUNT} // 130);
my @args = ($source, 'NET', $::target, \@packages, 0, 0);
$args[0] = $::target if $ENV{MODE} eq 'same-db';
$args[1] = 'local_compressed' if $ENV{MODE} eq 'local';
$args[4] = 1 if $ENV{MODE} eq 'src';
my $ok = eval {
    if ($ENV{MODE} eq 'list') {
        my @result = TeXLive::TLUtils::install_packages(@args);
        die 'list context changed' unless join(',', @result) eq 'installed,130';
    } elsif ($ENV{MODE} eq 'void') {
        TeXLive::TLUtils::install_packages(@args);
    } else {
        my $result = TeXLive::TLUtils::install_packages(@args);
        exit 8 unless $result;
    }
    # Hook must have been restored before installer post-configuration.
    $::target->save if $ENV{MODE} eq 'outside';
    open my $done, '>', "$ENV{TMPDIR}/complete" or die;
    print $done 'complete'; close $done or die;
    1;
};
if (!$ok) {
    my $error = $@;
    die 'exception identity changed' if $ENV{MODE} =~ /exception/ && refaddr($error) != refaddr($::exception);
    print STDERR $error unless ref($error);
    exit 7;
}
'''


def environment(root, batch, mode, **extra):
    values = dict(os.environ, TMPDIR=str(root), TEXLIVE_DATABASE_SAVE_BATCH=str(batch),
                  TEXLIVE_DISPOSABLE_CI="1", TEXLIVE_PREFETCH_WORKERS="0",
                  MODE=mode, CHAIN="")
    values.update(extra)
    return values


def run_fixture(batch=64, mode="normal", flags=("--no-continue",), **extra):
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        started = time.monotonic()
        result = subprocess.run(
            ["perl", "-I", str(ROOT / "renderer"), "-e", PROGRAM, "--", *flags],
            env=environment(root, batch, mode, **extra), text=True,
            capture_output=True, timeout=30,
        )
        elapsed = time.monotonic() - started
        reports = [json.loads(line[len(PREFIX):]) for line in result.stdout.splitlines()
                   if line.startswith(PREFIX)]
        database = root / "target/tlpkg/texlive.tlpdb"
        payload = database.read_bytes() if database.exists() else None
        trace = (root / "trace").read_text() if (root / "trace").exists() else ""
        completed = (root / "complete").exists()
        leftovers = list(root.rglob("*.tmp")) + list(root.rglob("texlive.tlpdb.verify-*"))
        return result, reports, payload, trace, completed, leftovers, elapsed


class DatabaseBatchTests(unittest.TestCase):
    def test_identical_database_and_bounded_checkpoint_counts(self):
        baseline = run_fixture(1)
        self.assertEqual(baseline[0].returncode, 0, baseline[0].stderr)
        self.assertEqual(baseline[1][0]["physical"], 131)
        for batch, writes in ((16, 9), (64, 3)):
            with self.subTest(batch=batch):
                result, reports, payload, _, complete, leftovers, _ = run_fixture(batch)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(payload, baseline[2])
                self.assertEqual(reports[0]["final_sha512"], hashlib.sha512(payload).hexdigest())
                self.assertEqual(reports[0]["requested"], 131)
                self.assertEqual(reports[0]["physical"], writes)
                self.assertEqual(reports[0]["verified"], writes + 1)
                self.assertEqual(reports[0]["pending"], 0)
                self.assertEqual(reports[0]["verification_peak_bytes"], len(payload))
                self.assertTrue(complete)
                self.assertEqual(leftovers, [])

    def test_postactions_always_see_the_current_complete_database(self):
        for batch in (1, 64):
            result, _, payload, _, complete, _, _ = run_fixture(batch, "post")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn(b"name pkg0130", payload)
            self.assertTrue(complete)

    def test_other_db_and_outside_scope_save_are_not_intercepted(self):
        for mode in ("source", "outside"):
            result, reports, _, trace, complete, _, _ = run_fixture(64, mode)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(reports[0]["physical"], 3)
            self.assertIn("source 1" if mode == "source" else "target 130", trace)
            self.assertEqual(len(trace.splitlines()), 4)
            self.assertTrue(complete)

    def test_unicode_metadata_has_identical_raw_file_bytes(self):
        for mode in ("unicode", "latin1"):
            with self.subTest(mode=mode):
                baseline = run_fixture(1, mode)
                candidate = run_fixture(64, mode)
                self.assertEqual(baseline[0].returncode, 0, baseline[0].stderr)
                self.assertEqual(candidate[0].returncode, 0, candidate[0].stderr)
                self.assertEqual(candidate[2], baseline[2])
                expected = "日本語".encode() if mode == "unicode" else b"\xe9"
                self.assertIn(expected, candidate[2])

    def test_upstream_style_format_write_has_identical_database_bytes(self):
        baseline = run_fixture(1, "format")
        candidate = run_fixture(64, "format")
        for result in (baseline, candidate):
            self.assertEqual(result[0].returncode, 0, result[0].stderr)
            self.assertTrue(result[4])
            self.assertEqual(result[5], [])
        self.assertEqual(candidate[2], baseline[2])
        self.assertIn(b"longdesc A long package description", candidate[2])

    def test_list_and_void_contexts_are_preserved(self):
        for batch in (1, 64):
            for mode in ("list", "void"):
                result, _, _, _, complete, _, _ = run_fixture(batch, mode)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(complete)

    def test_failed_install_return_is_not_published_as_complete(self):
        result, reports, payload, _, complete, _, _ = run_fixture(64, "install-false")
        self.assertEqual(result.returncode, 8, result.stderr)
        self.assertEqual(reports[0]["pending"], 0)
        self.assertIn(b"name pkg0005", payload)
        self.assertFalse(complete)

    def test_exceptions_enospc_and_truncated_database_never_complete(self):
        for mode in ("install-exception", "save-exception", "post-exception", "enospc", "verify-enospc", "verify-write-enospc", "truncate", "save-false"):
            with self.subTest(mode=mode):
                result, reports, _, _, complete, leftovers, _ = run_fixture(64, mode)
                self.assertEqual(result.returncode, 7, result.stderr)
                self.assertNotIn("exception identity changed", result.stderr)
                self.assertEqual(leftovers, [])
                self.assertEqual(reports[0]["returned"], 0)
                self.assertFalse(complete)

    def test_wrong_or_non_disposable_scope_is_rejected_before_install(self):
        for mode in ("virtual", "same-db", "local", "src", "wrong-program", "missing", "missing-post", "wrong-order", "nested"):
            with self.subTest(mode=mode):
                result, _, _, trace, complete, _, _ = run_fixture(64, mode)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(trace, "")
                self.assertFalse(complete)
        result = run_fixture(64, flags=())[0]
        self.assertNotEqual(result.returncode, 0)
        result = run_fixture(64, TEXLIVE_DISPOSABLE_CI="0")[0]
        self.assertNotEqual(result.returncode, 0)

    def test_invalid_batch_is_rejected(self):
        for batch in ("", "-1", "0", "65", "1.5", "64;touch ignored"):
            result, _, _, trace, complete, _, _ = run_fixture(batch)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(trace, "")
            self.assertFalse(complete)

    def test_combined_preload_metrics_include_the_flushed_database(self):
        result, reports, _, _, complete, _, _ = run_fixture(64, CHAIN="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(complete)
        self.assertEqual(reports[0]["pending"], 0)
        self.assertLess(result.stdout.index(PREFIX), result.stdout.index("TEXLIVE_PACKAGE_METRICS "))

    def test_nonresuming_scope_survives_installer_argument_parsing(self):
        result = run_fixture(64, "consume-args")[0]
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_unknown_future_save_arguments_fail_only_the_candidate(self):
        baseline = run_fixture(1, "save-args")
        candidate = run_fixture(64, "save-args")
        self.assertEqual(baseline[0].returncode, 0, baseline[0].stderr)
        self.assertEqual(candidate[0].returncode, 7, candidate[0].stderr)
        self.assertFalse(candidate[4])

    def test_force_kill_leaves_only_an_incomplete_bounded_checkpoint(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            child = subprocess.Popen(
                ["perl", "-I", str(ROOT / "renderer"), "-e", PROGRAM, "--", "--no-continue"],
                env=environment(root, 64, "kill"), text=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            )
            try:
                self.assertTrue(select.select([child.stdout], [], [], 10)[0])
                self.assertEqual(child.stdout.readline(), "checkpoint-ready\n")
                child.kill()
                stdout, stderr = child.communicate(timeout=10)
                self.assertLess(child.returncode, 0, stderr)
                self.assertNotIn(PREFIX, stdout)
                self.assertFalse((root / "complete").exists())
                checkpoint = (root / "target/tlpkg/texlive.tlpdb").read_text()
                self.assertEqual(checkpoint.count("name pkg"), 64)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.communicate(timeout=10)


def benchmark():
    """Small repeated-serialization model, not a real TeX/Actions speed claim."""
    expected = None
    records = []
    for batch in (1, 16, 64):
        result, reports, payload, _, complete, leftovers, elapsed = run_fixture(
            batch, COUNT="1500", PAYLOAD_BYTES="512")
        if result.returncode or not complete or leftovers:
            raise RuntimeError(result.stderr)
        if expected is None:
            expected = payload
        if payload != expected:
            raise RuntimeError("Final database bytes differ")
        record = reports[0]
        record["fixture_wall_seconds"] = round(elapsed, 3)
        record["final_bytes"] = len(payload)
        records.append(record)
    print(json.dumps(records, sort_keys=True))


if __name__ == "__main__":
    if sys.argv[1:] == ["--benchmark"]:
        benchmark()
    else:
        unittest.main()
