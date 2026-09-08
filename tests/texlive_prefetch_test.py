"""Bounded HTTPS prefetch tests; no TeX Live installation or external network."""
import hashlib
import http.server
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
PAYLOAD = b"archive fixture" * 512


class PrefetchTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.directory = Path(cls.temp.name)
        cls.cert = cls.directory / "cert.pem"
        key = cls.directory / "key.pem"
        subprocess.run([
            "openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
            "-keyout", str(key), "-out", str(cls.cert), "-days", "1",
            "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost",
        ], check=True, capture_output=True)
        cls.active = 0
        cls.peak = 0
        cls.requests = []
        cls.connections = set()
        cls.lock = threading.Lock()

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                with cls.lock:
                    cls.active += 1
                    cls.peak = max(cls.peak, cls.active)
                    cls.requests.append(self.path)
                    cls.connections.add(self.client_address)
                try:
                    time.sleep(0.08)
                    data = PAYLOAD if "oversize" not in self.path else PAYLOAD * 2
                    self.send_response(200 if self.headers.get("User-Agent") == "texlive/lwp" else 403)
                    self.send_header("Content-Length", str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError, ssl.SSLError):
                    pass
                finally:
                    with cls.lock:
                        cls.active -= 1

            def log_message(self, *_args):
                pass

        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cls.cert, key)
        cls.server.socket = context.wrap_socket(cls.server.socket, server_side=True)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"https://localhost:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def run_pool(self, workers=4, count=12, sha=None, name="pkg", budget=None,
                 trust=True, mode="normal", size=None, expect_failure=False):
        plan = [{"url": f"{self.url}/{name}{i}.tar.xz", "size": len(PAYLOAD) if size is None else size,
                 "sha": sha or hashlib.sha512(PAYLOAD).hexdigest()}
                for i in range(count)]
        # Stub only the original TLUtils entry points. The actual worker,
        # HTTPS transport, scheduler, hashing and file transfer are exercised.
        program = r'''
BEGIN {
    package TeXLive::TLUtils;
    sub install_packages { die "unexpected install" }
    sub download_file { die "unexpected fallback" }
    $INC{'TeXLive/TLUtils.pm'} = 1;
}
use TeXLivePrefetch;
use JSON::PP qw(decode_json);
use Digest::SHA qw(sha512_hex);
my $plan = decode_json(do { local $/; <STDIN> });
my $pool = TeXLivePrefetch->new($plan);
chdir $ENV{TMPDIR} or die if $ENV{PREFETCH_TEST_MODE} eq 'chdir';
if ($ENV{PREFETCH_TEST_MODE} eq 'readonly') { chmod 0555, "$pool->{dir}" or die; }
if ($ENV{PREFETCH_TEST_MODE} eq 'dead_worker') {
    my $pid;
    for (1 .. 100) {
        open my $children, '<', "/proc/$pool->{coordinator}/task/$pool->{coordinator}/children" or die;
        ($pid) = split /\s+/, (<$children> // '');
        close $children;
        last if $pid;
        select undef, undef, undef, 0.01;
    }
    die 'worker not started' unless $pid;
    kill 'KILL', $pid;
    # Avoid SIGPIPE racing with the death notification in this fault test.
    $SIG{PIPE} = 'IGNORE';
}
if ($ENV{PREFETCH_TEST_MODE} eq 'dead_coordinator') {
    # TERM allows the coordinator to reap workers before reporting failure.
    select undef, undef, undef, 0.1;
    kill 'TERM', $pool->{coordinator};
    select undef, undef, undef, 0.1;
}
my @result;
my @order = @$plan;
@order = ($plan->[0], $plan->[8], $plan->[0], @$plan) if $ENV{PREFETCH_TEST_MODE} eq 'retry';
for my $entry (@order) {
    my $dest = "$ENV{TMPDIR}/current";
    $dest = 'current' if $ENV{PREFETCH_TEST_MODE} eq 'chdir';
    my $ok = eval { $pool->download($entry->{url}, $dest) };
    if ($@) { print "worker error detected\n"; last; }
    push @result, defined($ok) ? $ok : 'fallback';
    if ($ok) {
        open my $in, '<', $dest or die;
        binmode $in;
        die "bad returned payload" unless sha512_hex(do { local $/; <$in> }) eq $entry->{sha};
        close $in;
        unlink $dest or die;
    }
    if ($ENV{PREFETCH_TEST_MODE} eq 'idle' && @result <= 2) {
        # Simulate extraction: no downloader calls while workers finish and
        # the coordinator refills. Count only fully verified ready files.
        select undef, undef, undef, 2;
        my @ready = glob "$pool->{dir}/*";
        @ready = grep { /\/[0-9]+$/ } @ready;
        print 'idle_ready=', scalar(@ready), "\n";
    }
}
print JSON::PP::encode_json(\@result), "\n";
$pool->stop;
chmod 0755, "$pool->{dir}";
undef $pool;
'''
        with tempfile.TemporaryDirectory() as temporary:
            env = dict(os.environ, TMPDIR=temporary,
                       TEXLIVE_PREFETCH_WORKERS=str(workers),
                       TEXLIVE_PREFETCH_BYTES=str(budget or 4 * len(PAYLOAD)),
                       TEXLIVE_PREFETCH_WINDOW="20", PREFETCH_TEST_MODE=mode)
            if trust:
                env["PERL_LWP_SSL_CA_FILE"] = str(self.cert)
            else:
                env.pop("PERL_LWP_SSL_CA_FILE", None)
            start = time.monotonic()
            result = subprocess.run(
                ["perl", "-I", str(ROOT / "renderer"), "-e", program],
                input=json.dumps(plan), env=env, text=True, capture_output=True,
                timeout=30,
            )
            elapsed = time.monotonic() - start
            if expect_failure:
                self.assertNotEqual(result.returncode, 0)
            else:
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(list(Path(temporary).iterdir()), [])
            return result.stdout, elapsed

    def test_parallel_downloads_preserve_order_and_bound_bytes(self):
        self.connections.clear()
        serial, serial_time = self.run_pool(workers=1)
        self.assertEqual(len(self.connections), 1)
        self.connections.clear()
        self.__class__.peak = 0
        parallel, parallel_time = self.run_pool(workers=4)
        self.assertIn(json.dumps([1] * 12, separators=(",", ":")), parallel)
        self.assertIn(f"peak_reserved_bytes={4 * len(PAYLOAD)}", parallel)
        self.assertGreater(self.peak, 1)
        self.assertLessEqual(self.peak, 4)
        self.assertLessEqual(len(self.connections), 4)
        self.assertIn("verified_bytes=", serial)
        # Wide margin: delayed fixtures test overlap, not internet speed.
        self.assertLess(parallel_time, serial_time * 0.85)

    def test_checksum_failure_is_not_returned_to_installer(self):
        output, _ = self.run_pool(count=1, sha="0" * 128)
        self.assertIn("[0]", output)
        self.assertIn("verified_bytes=0", output)

    def test_refills_during_extraction_and_stops_at_twenty(self):
        output, _ = self.run_pool(count=25, budget=30 * len(PAYLOAD), mode="idle")
        self.assertEqual(output.count("idle_ready=20"), 2, output)
        self.assertIn(f"peak_reserved_bytes={20 * len(PAYLOAD)}", output)
        self.assertIn(json.dumps([1] * 25, separators=(",", ":")), output)

    def test_byte_limit_pauses_below_twenty_and_resumes_after_consumption(self):
        output, _ = self.run_pool(count=25, budget=6 * len(PAYLOAD) + 1, mode="idle")
        self.assertEqual(output.count("idle_ready=6"), 2, output)
        self.assertIn(f"peak_reserved_bytes={6 * len(PAYLOAD)}", output)
        self.assertIn(json.dumps([1] * 25, separators=(",", ":")), output)

    def test_oversized_response_is_discarded(self):
        output, _ = self.run_pool(count=1, name="oversize")
        self.assertIn("[0]", output)
        self.assertIn("verified_bytes=0", output)

    def test_object_exceeding_budget_uses_standard_path(self):
        output, _ = self.run_pool(count=1, budget=1)
        self.assertIn('["fallback"]', output)
        self.assertIn("peak_reserved_bytes=0", output)

    def test_untrusted_https_certificate_is_rejected(self):
        output, _ = self.run_pool(count=1, trust=False)
        self.assertIn("[0]", output)

    def test_unknown_size_uses_standard_path(self):
        output, _ = self.run_pool(count=1, size=0)
        self.assertIn('["fallback"]', output)

    def test_worker_death_is_detected_and_cleaned_up(self):
        output, _ = self.run_pool(count=1, workers=1, mode="dead_worker")
        self.assertIn("worker error detected", output)

    def test_coordinator_death_is_detected_and_cleaned_up(self):
        output, _ = self.run_pool(count=1, mode="dead_coordinator")
        self.assertIn("worker error detected", output)

    def test_relative_destination_after_installer_changes_directory(self):
        output, _ = self.run_pool(count=1, mode="chdir")
        self.assertIn("[1]", output)

    def test_skipped_packages_and_backward_retry_do_not_deadlock(self):
        output, _ = self.run_pool(mode="retry")
        self.assertNotIn("worker error detected", output)
        self.assertNotIn("[0", output)
        self.assertIn(f"peak_reserved_bytes={4 * len(PAYLOAD)}", output)

    @unittest.skipIf(os.geteuid() == 0, "root bypasses fixture directory permissions")
    def test_unwritable_buffer_fails_without_returning_a_file(self):
        output, _ = self.run_pool(count=1, mode="readonly")
        self.assertIn("[0]", output)

    def test_invalid_worker_count_is_rejected(self):
        self.run_pool(count=1, workers=9, expect_failure=True)


if __name__ == "__main__":
    unittest.main()
