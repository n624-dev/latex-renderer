import datetime as dt
import contextlib
import errno
import hashlib
import importlib.util
import io
import json
import os
import sys
import signal
import subprocess
import time
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock

MODULE = Path(__file__).parents[1] / "deploy/texlive-mirror/texlive_mirror.py"
SPEC = importlib.util.spec_from_file_location("texlive_mirror", MODULE)
mirror = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = mirror
SPEC.loader.exec_module(mirror)


class MirrorTest(unittest.TestCase):
    def probe_result(self, code=0, status=200):
        return subprocess.CompletedProcess(
            [],
            code,
            json.dumps(
                {
                    "http_code": status,
                    "remote_ip": "192.0.2.1",
                    "time_namelookup": 0.01,
                    "time_connect": 0.1,
                    "time_appconnect": 0.3,
                    "time_total": 0.4,
                    "url_effective": "https://private.invalid/?token=do-not-log",
                }
            ),
            "private stderr do-not-log",
        )

    def test_probe_retries_same_date_and_logs_only_whitelisted_metrics(self):
        with (
            mock.patch.object(
                mirror.subprocess,
                "run",
                side_effect=[
                    self.probe_result(28, 0),
                    self.probe_result(22, 503),
                    self.probe_result(),
                ],
            ) as run,
            mock.patch.object(mirror.time, "sleep") as sleep,
            contextlib.redirect_stdout(io.StringIO()) as output,
        ):
            self.assertTrue(mirror.probe_archive(self.config, dt.date(2026, 9, 9)))
        self.assertEqual(run.call_count, 3)
        self.assertEqual(len({call.args[0][-1] for call in run.call_args_list}), 1)
        self.assertEqual(sleep.call_count, 2)
        self.assertNotIn("do-not-log", output.getvalue())
        self.assertNotIn("https://", output.getvalue())
        self.assertEqual(
            json.loads(output.getvalue().splitlines()[0])["remoteIp"], "192.0.2.1"
        )

    def test_probe_transport_failure_does_not_search_older_dates(self):
        with (
            mock.patch.object(
                mirror.subprocess, "run", return_value=self.probe_result(28, 0)
            ) as run,
            mock.patch.object(mirror.time, "sleep"),
        ):
            with self.assertRaises(mirror.TransportError):
                mirror.resolve_latest_date(
                    self.config, dt.datetime(2026, 9, 9, tzinfo=dt.timezone.utc)
                )
        self.assertEqual(run.call_count, 3)
        self.assertEqual(len({call.args[0][-1] for call in run.call_args_list}), 1)

    def test_probe_missing_date_can_search_previous_date(self):
        with mock.patch.object(
            mirror.subprocess,
            "run",
            side_effect=[self.probe_result(22, 404), self.probe_result()],
        ) as run:
            self.assertEqual(
                mirror.resolve_latest_date(
                    self.config, dt.datetime(2026, 9, 9, tzinfo=dt.timezone.utc)
                ),
                "2026-09-08",
            )
        self.assertIn("2026/09/09", run.call_args_list[0].args[0][-1])
        self.assertIn("2026/09/08", run.call_args_list[1].args[0][-1])

    def test_probe_auth_certificate_and_malformed_metrics_fail_closed(self):
        for result in [
            self.probe_result(22, 403),
            self.probe_result(60, 0),
            subprocess.CompletedProcess([], 0, "not json"),
        ]:
            with (
                self.subTest(result=result),
                mock.patch.object(mirror.subprocess, "run", return_value=result) as run,
            ):
                with self.assertRaises(mirror.VerificationError):
                    mirror.probe_archive(self.config, dt.date(2026, 9, 9))
                self.assertEqual(run.call_count, 1)

    def test_probe_process_timeout_is_bounded_and_classified(self):
        with (
            mock.patch.object(
                mirror.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired("curl", 65),
            ) as run,
            mock.patch.object(mirror.time, "sleep"),
        ):
            with self.assertRaises(mirror.TransportError):
                mirror.probe_archive(self.config, dt.date(2026, 9, 9))
        self.assertEqual(run.call_count, 3)

    def test_retry_cycle_keeps_resolved_date_and_retries_at_offsets(self):
        clock = [0.0]
        sleeps = []

        def wait(seconds):
            # A waiting retry cycle must not retain the lock GC needs to
            # reclaim abandoned staging. Both locks are actual flock locks.
            with mirror.locked(self.root / "state/locks/sync.lock", nonblocking=True):
                pass
            sleeps.append(seconds)
            clock[0] += seconds

        with (
            mock.patch.object(mirror, "storage_guard_ready"),
            mock.patch.object(mirror, "gc"),
            mock.patch.object(
                mirror, "resolve_latest_date", return_value="2026-09-09"
            ) as resolve,
            mock.patch.object(
                mirror,
                "_sync_attempt",
                side_effect=[
                    mirror.TransportError("temporary"),
                    mirror.TransportError("temporary"),
                    {"status": "published"},
                ],
            ) as attempt,
            mock.patch.object(mirror.time, "monotonic", side_effect=lambda: clock[0]),
            mock.patch.object(mirror.time, "sleep", side_effect=wait),
        ):
            result = mirror.sync(self.config, "latest")
        self.assertEqual(result["status"], "published")
        self.assertEqual(sleeps, [900, 900])
        self.assertEqual(resolve.call_count, 1)
        self.assertEqual(
            [call.args[1] for call in attempt.call_args_list], ["2026-09-09"] * 3
        )

    def test_resolver_failure_records_event_and_keeps_original_date_anchor(self):
        anchor = dt.datetime(2026, 9, 9, 23, 59, tzinfo=dt.timezone.utc)
        with (
            mock.patch.object(mirror, "storage_guard_ready"),
            mock.patch.object(mirror, "gc"),
            mock.patch.object(
                mirror,
                "resolve_latest_date",
                side_effect=mirror.TransportError("temporary"),
            ) as resolve,
            mock.patch.object(mirror.time, "sleep"),
            mock.patch.object(mirror, "_sync_attempt") as attempt,
        ):
            with self.assertRaises(mirror.TransportError):
                mirror.sync(self.config, "latest", anchor)
        self.assertEqual(resolve.call_count, 3)
        self.assertTrue(all(call.args[1] == anchor for call in resolve.call_args_list))
        attempt.assert_not_called()
        self.assertEqual(
            mirror.load_state(self.config)["lastEvent"]["kind"], "upstream_unavailable"
        )

    def test_validation_and_capacity_errors_are_not_retried(self):
        for error in [
            mirror.VerificationError("bad signature"),
            mirror.CapacityBlocked("full"),
        ]:
            with (
                self.subTest(error=error),
                mock.patch.object(mirror, "storage_guard_ready"),
                mock.patch.object(mirror, "gc"),
                mock.patch.object(
                    mirror, "_sync_attempt", side_effect=error
                ) as attempt,
                mock.patch.object(mirror.time, "sleep") as sleep,
            ):
                with self.assertRaises(type(error)):
                    mirror.sync(self.config, "2026-09-09")
                self.assertEqual(attempt.call_count, 1)
                sleep.assert_not_called()

    def test_cycle_lock_prevents_overlapping_retry_jobs(self):
        with (
            mirror.locked(self.root / "state/locks/cycle.lock"),
            mock.patch.object(mirror, "storage_guard_ready"),
            mock.patch.object(mirror, "_sync_attempt") as attempt,
        ):
            with self.assertRaisesRegex(mirror.MirrorError, "lock is busy"):
                mirror.sync(self.config, "2026-09-09")
            attempt.assert_not_called()

    def test_retry_cannot_wait_beyond_total_deadline(self):
        with (
            mock.patch.object(mirror, "storage_guard_ready"),
            mock.patch.object(mirror, "gc"),
            mock.patch.object(
                mirror, "_sync_attempt", side_effect=mirror.TransportError("temporary")
            ),
            mock.patch.object(
                mirror.time,
                "monotonic",
                side_effect=[0, 0, self.config.sync_timeout - 1],
            ),
            mock.patch.object(mirror.time, "sleep") as sleep,
        ):
            with self.assertRaises(mirror.SyncDeadline):
                mirror.sync(self.config, "2026-09-09")
            sleep.assert_not_called()

    def test_wall_clock_deadline_interrupts_wait_and_restores_handler(self):
        previous = signal.getsignal(signal.SIGALRM)
        with self.assertRaises(mirror.SyncDeadline):
            with mirror.sync_deadline(0.02):
                time.sleep(0.2)
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous)

    def test_retry_configuration_bounds(self):
        for changes in [
            {"sync_retry_offsets_seconds": [900, 900]},
            {"sync_retry_offsets_seconds": [True]},
            {"sync_retry_offsets_seconds": [900, 1800, 2700]},
            {"sync_retry_offsets_seconds": [999999]},
            {"upstream_probe_attempts": 6},
            {"upstream_connect_timeout_seconds": 61},
        ]:
            with self.subTest(changes=changes):
                self.write_config(**changes)
                with self.assertRaises(mirror.ConfigError):
                    mirror.Config.load(self.config_path)

    def test_delayed_retries_can_be_disabled(self):
        self.write_config(sync_retry_offsets_seconds=[])
        config = mirror.Config.load(self.config_path)
        with (
            mock.patch.object(mirror, "storage_guard_ready"),
            mock.patch.object(mirror, "gc"),
            mock.patch.object(
                mirror, "_sync_attempt", side_effect=mirror.TransportError("temporary")
            ) as attempt,
            mock.patch.object(mirror.time, "sleep") as sleep,
        ):
            with self.assertRaises(mirror.TransportError):
                mirror.sync(config, "2026-09-09")
            self.assertEqual(attempt.call_count, 1)
            sleep.assert_not_called()

    def test_upstream_notifications_are_bounded_across_retries(self):
        self.write_config(notify_command=["fixture-notifier"])
        config = mirror.Config.load(self.config_path)
        state = mirror.load_state(config)
        now = dt.datetime(2026, 9, 9, tzinfo=dt.timezone.utc)
        with mock.patch.object(mirror.subprocess, "run") as notify:
            for seconds in [0, 900, 1800, 21599]:
                mirror.emit_event(
                    config,
                    state,
                    "upstream_unavailable",
                    {},
                    now + dt.timedelta(seconds=seconds),
                )
            self.assertEqual(notify.call_count, 1)
            mirror.emit_event(
                config,
                state,
                "upstream_unavailable",
                {},
                now + dt.timedelta(hours=6),
            )
            self.assertEqual(notify.call_count, 2)
            mirror.emit_event(
                config,
                state,
                "verification_failed",
                {},
                now + dt.timedelta(hours=6, seconds=1),
            )
            self.assertEqual(notify.call_count, 3)

    def setUp(self):
        test_parent = os.environ.get("TEXLIVE_MIRROR_TEST_TMPDIR")
        self.temp = tempfile.TemporaryDirectory(dir=test_parent)
        self.root = Path(self.temp.name) / "managed"
        self.profile = Path(self.temp.name) / "profile"
        self.profile.write_text(
            "binary_x86_64-linux 1\ncollection-basic 1\ntlpdbopt_install_docfiles 0\ntlpdbopt_install_srcfiles 0\n"
        )
        self.config_path = Path(self.temp.name) / "config.json"
        self.write_config()
        self.config = mirror.Config.load(self.config_path)
        mirror.ensure_layout(self.config)
        mirror.save_state(self.config, mirror.default_state())

    def tearDown(self):
        self.temp.cleanup()

    def write_config(self, **changes):
        value = {
            "root": str(self.root),
            "public_base_url": "https://mirror.example",
            "upstream_base_url": "https://upstream.example",
            "active_year": 2026,
            "architectures": ["amd64"],
            "profile": str(self.profile),
            "keyring": str(Path(self.temp.name) / "keyring"),
            "hard_limit_gib": 15,
            "gc_start_gib": 11,
            "gc_target_gib": 9,
            "sync_peak_limit_gib": 14,
            "os_free_min_gib": 3,
            "keep_generations": 3,
            "keep_hours": 72,
            "sync_timeout_minutes": 120,
            "ci_job_timeout_minutes": 360,
            "reservation_ttl_hours": 8,
            "max_reserved_snapshots": 2,
            "metadata_headroom_mib": 1,
            "temporary_space_percent": 100,
            "hard_limit_enforcement": "application",
            "sync_enabled": True,
            "validation_collections": [
                "collection-langenglish",
                "collection-langjapanese",
            ],
        }
        value.update(changes)
        self.config_path.write_text(json.dumps(value))

    def sid(self, number, year=2026):
        return f"tl{year}-{number:016x}-{'a' * 16}-{'b' * 16}-v1"

    def publish(self, number, hours_ago=0, year=2026, shared=None):
        now = dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc) - dt.timedelta(
            hours=hours_ago
        )
        sid = self.sid(number, year)
        path = self.root / "snapshots" / sid
        (path / "tlnet/archive").mkdir(parents=True)
        file = path / "tlnet/archive/a.tar.xz"
        if shared:
            os.link(shared, file)
        else:
            file.write_bytes(b"content")
        checksum = mirror.sha512_file(file)
        manifest = {
            "selection": {
                "architectures": list(self.config.architectures),
                "format": 1,
            },
            "files": [
                {
                    "path": "archive/a.tar.xz",
                    "sha512": checksum,
                    "size": file.stat().st_size,
                }
            ],
        }
        mirror.atomic_json(path / ".snapshot.json", manifest)
        state = mirror.load_state(self.config)
        state["snapshots"][sid] = {
            "year": year,
            "publishedAt": mirror.iso(now),
            "status": "published",
            "canonicalDate": f"{year}-09-{number:02d}",
            "canonicalDates": [f"{year}-09-{number:02d}"],
            "databaseSha512": "c" * 128,
            "installerSha512": "d" * 128,
        }
        state["latest"] = sid
        mirror.save_state(self.config, state)
        return sid, file

    def test_config_order_and_timeout_validation(self):
        self.write_config(gc_target_gib=11)
        with self.assertRaises(mirror.ConfigError):
            mirror.Config.load(self.config_path)
        self.write_config(reservation_ttl_hours=2)
        with self.assertRaises(mirror.ConfigError):
            mirror.Config.load(self.config_path)

    def test_gc_timer_runs_after_boot_and_every_fifteen_minutes(self):
        timer = (MODULE.parents[1] / "systemd/texlive-ci-gc.timer").read_text()
        self.assertIn("OnBootSec=1min", timer)
        self.assertIn("OnCalendar=*:0/15", timer)
        self.assertIn("Persistent=true", timer)
        sync_service = (
            MODULE.parents[1] / "systemd/texlive-ci-sync.service"
        ).read_text()
        self.assertIn("MemoryMax=768M", sync_service)

    def test_fourth_generation_deletes_oldest(self):
        for i in range(1, 5):
            self.publish(i, hours_ago=4 - i)
        result = mirror.gc(self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc))
        self.assertEqual(result["deletedSnapshots"], [self.sid(1)])

    def test_older_than_72_hours_is_deleted_but_latest_survives(self):
        old, _ = self.publish(1, hours_ago=100)
        newest, _ = self.publish(2, hours_ago=99)
        result = mirror.gc(self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc))
        self.assertIn(old, result["deletedSnapshots"])
        self.assertNotIn(newest, result["deletedSnapshots"])

    def test_snapshot_id_is_content_idempotent(self):
        selection = {"architectures": ["amd64"], "packages": ["a"], "format": 1}
        self.assertEqual(
            mirror.make_snapshot_id(2026, "a" * 128, "b" * 128, selection),
            mirror.make_snapshot_id(2026, "a" * 128, "b" * 128, selection),
        )
        self.assertNotEqual(
            mirror.make_snapshot_id(2026, "a" * 128, "b" * 128, selection),
            mirror.make_snapshot_id(
                2026, "a" * 128, "b" * 128, {**selection, "architectures": ["arm64"]}
            ),
        )

    def test_reservation_protects_old_and_is_idempotent(self):
        old, _ = self.publish(1, hours_ago=100)
        self.publish(2)
        now = dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
        first = mirror.reserve(self.config, old, None, "10:1:build:amd64", "amd64", now)
        again = mirror.reserve(
            self.config,
            old,
            None,
            "10:1:build:amd64",
            "amd64",
            now + dt.timedelta(hours=1),
        )
        self.assertEqual(first["expiresAt"], again["expiresAt"])
        self.assertNotIn(old, mirror.gc(self.config, now)["deletedSnapshots"])
        self.assertTrue(mirror.release(self.config, first["token"], first["owner"]))
        self.assertFalse(mirror.release(self.config, first["token"], first["owner"]))

    def test_architecture_reservations_are_independent_and_expire(self):
        self.write_config(architectures=["amd64", "arm64"])
        self.profile.write_text(
            "binary_x86_64-linux 1\nbinary_aarch64-linux 1\ncollection-basic 1\ntlpdbopt_install_docfiles 0\ntlpdbopt_install_srcfiles 0\n"
        )
        self.config = mirror.Config.load(self.config_path)
        sid, _ = self.publish(1)
        now = dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
        amd = mirror.reserve(self.config, sid, None, "10:1:build:amd64", "amd64", now)
        arm = mirror.reserve(self.config, sid, None, "10:1:build:arm64", "arm64", now)
        self.assertNotEqual(amd["token"], arm["token"])
        self.assertTrue(mirror.release(self.config, amd["token"], amd["owner"]))
        self.assertEqual([arm], mirror.active_reservations(self.config, now))
        self.assertEqual(
            [], mirror.active_reservations(self.config, now + dt.timedelta(hours=9))
        )

    def test_at_most_two_distinct_reserved_snapshots(self):
        ids = [self.publish(i)[0] for i in range(1, 4)]
        now = dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
        for i in range(2):
            mirror.reserve(self.config, ids[i], None, f"{i}:1:job:amd64", "amd64", now)
        with self.assertRaises(mirror.CapacityBlocked):
            mirror.reserve(self.config, ids[2], None, "3:1:job:amd64", "amd64", now)

    def test_canonical_date_prefers_explicit_latest_after_format_migration(self):
        old, _ = self.publish(1)
        latest, _ = self.publish(2)
        state = mirror.load_state(self.config)
        state["snapshots"][old]["canonicalDate"] = "2026-09-07"
        state["snapshots"][old]["canonicalDates"] = ["2026-09-07"]
        state["snapshots"][latest]["canonicalDate"] = "2026-09-07"
        state["snapshots"][latest]["canonicalDates"] = ["2026-09-07"]
        mirror.save_state(self.config, state)

        lease = mirror.reserve(
            self.config,
            None,
            "2026-09-07",
            "10:1:build:amd64",
            "amd64",
            dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc),
        )
        self.assertEqual(lease["snapshotId"], latest)

    def test_management_lock_serializes_reservation_and_gc(self):
        old, _ = self.publish(1, hours_ago=100)
        self.publish(2)
        now = dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
        barrier = threading.Barrier(2)
        errors = []

        def do_reserve():
            try:
                barrier.wait()
                mirror.reserve(self.config, old, None, "1:1:job:amd64", "amd64", now)
            except Exception as error:
                errors.append(error)

        def do_gc():
            try:
                barrier.wait()
                mirror.gc(self.config, now)
            except Exception as error:
                errors.append(error)

        threads = [threading.Thread(target=do_reserve), threading.Thread(target=do_gc)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertLessEqual(len(errors), 1)
        # Either GC won and reservation failed safely, or reservation won and the directory remains.
        reservations = mirror.active_reservations(self.config, now)
        if reservations:
            self.assertTrue((self.root / "snapshots" / old).is_dir())

    def test_internal_source_protection_and_expiry(self):
        old, _ = self.publish(1, hours_ago=100)
        self.publish(2)
        now = dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
        state = mirror.load_state(self.config)
        mirror.protect(self.config, state, old, "sync-run", now)
        mirror.save_state(self.config, state)
        self.assertNotIn(old, mirror.gc(self.config, now)["deletedSnapshots"])
        self.assertIn(
            old, mirror.gc(self.config, now + dt.timedelta(hours=3))["deletedSnapshots"]
        )

    def test_staging_recovery_uses_operation_deadline(self):
        now = dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
        stage = self.root / "staging/run-old"
        stage.mkdir()
        mirror.atomic_json(
            stage / ".operation.json",
            {"runId": "old", "deadline": mirror.iso(now - dt.timedelta(seconds=1))},
        )
        mirror.gc(self.config, now)
        self.assertFalse(stage.exists())

    def test_threshold_peak_includes_temp_and_unknown_size_rejected(self):
        metrics = {"managedBytes": 8}
        files = [{"sha512": "a", "size": 2}]
        self.assertEqual(mirror.estimate_peak(metrics, files, {}, 1, 1500), (14, 2))
        packages = {
            "a": mirror.Package("a", "1", [], "a" * 128, None, None, None, None, None)
        }
        with self.assertRaises(mirror.VerificationError):
            mirror.package_files(packages, {"a"})

    def test_tlpdb_rejects_unsafe_revision_and_duplicate_singular_fields(self):
        checksum = "a" * 128
        for text in (
            f"name a\nrevision ../1\ncontainersize 1\ncontainerchecksum {checksum}\n",
            f"name a\nrevision 1\nrevision 2\ncontainersize 1\ncontainerchecksum {checksum}\n",
            f"name a\ncontainersize 1\ncontainerchecksum {checksum}\n",
        ):
            with self.subTest(text=text):
                with self.assertRaises(mirror.VerificationError):
                    mirror.parse_tlpdb(text)
        package = mirror.Package("a", "../1", [], checksum, 1, None, None, None, None)
        with self.assertRaises(mirror.VerificationError):
            mirror.package_files({"a": package}, {"a"})

    def test_download_budget_removes_oversized_partial(self):
        destination = self.root / "staging/download"

        class FakeProcess:
            def __init__(self):
                self.stdout = io.BytesIO(b"too large")
                self.returncode = None

            def kill(self):
                self.returncode = -9

            def wait(self):
                self.returncode = self.returncode if self.returncode is not None else 0
                return self.returncode

            def poll(self):
                return self.returncode

        with mock.patch.object(mirror.subprocess, "Popen", return_value=FakeProcess()):
            with self.assertRaises(mirror.VerificationError):
                mirror.curl_download(
                    "https://upstream.example/file", destination, max_size=3
                )
        self.assertFalse(destination.exists())
        self.assertFalse(destination.with_name("download.partial").exists())

    def test_11_gib_pressure_runs_early_gc(self):
        old, _ = self.publish(1, hours_ago=1)
        self.publish(2)
        high = {
            "managedBytes": 11 * mirror.GIB,
            "filesystemFreeBytes": 4 * mirror.GIB,
            "osFilesystemFreeBytes": 4 * mirror.GIB,
            "inodeFree": 100,
            "inodeTotal": 200,
        }
        low = {**high, "managedBytes": 9 * mirror.GIB}
        with mock.patch.object(
            mirror, "filesystem_metrics", side_effect=[high, low, low]
        ):
            result = mirror.gc(
                self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
            )
        self.assertIn(old, result["deletedSnapshots"])

    def fake_metadata(self, _config, _date, tlnet):
        payload_checksum = hashlib.sha512(b"payload").hexdigest()
        text = (
            "\n\n".join(
                [
                    "name 00texlive.config\nrevision 1\ndepend release/2026",
                    "name collection-basic\nrevision 1\ndepend payload",
                    "name collection-langenglish\nrevision 1",
                    "name collection-langjapanese\nrevision 1",
                    f"name payload\nrevision 1\ncontainersize 7\ncontainerchecksum {payload_checksum}",
                ]
            )
            + "\n"
        )
        for relative in [
            "install-tl-unx.tar.gz",
            "install-tl-unx.tar.gz.sha512",
            "install-tl-unx.tar.gz.sha512.asc",
            "tlpkg/texlive.tlpdb.xz",
            "tlpkg/texlive.tlpdb.sha512",
            "tlpkg/texlive.tlpdb.sha512.asc",
        ]:
            path = tlnet / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(relative.encode())
        return (
            text.encode(),
            "c" * 128,
            "d" * 128,
            "https://upstream.example/2026/09/07/tlnet",
        )

    def test_same_sync_is_unchanged_and_does_not_add_generation(self):
        def download(_url, target, expected_size=None):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"payload")
            self.assertEqual(expected_size, 7)

        now = dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
        with (
            mock.patch.object(
                mirror, "verified_metadata", side_effect=self.fake_metadata
            ),
            mock.patch.object(mirror, "curl_download", side_effect=download),
        ):
            first = mirror.sync(self.config, "2026-09-07", now)
            second = mirror.sync(self.config, "2026-09-07", now + dt.timedelta(hours=1))
        self.assertEqual(first["status"], "published")
        self.assertEqual(second["status"], "unchanged")
        self.assertEqual(first["snapshotId"], second["snapshotId"])
        self.assertEqual(len(mirror.load_state(self.config)["snapshots"]), 1)
        snapshot = self.root / "snapshots" / first["snapshotId"]
        self.assertIn(
            "name 00texlive.config",
            (snapshot / "tlnet" / "tlpkg" / "texlive.tlpdb").read_text(),
        )
        manifest = json.loads((snapshot / ".snapshot.json").read_text())
        self.assertEqual(manifest["selection"]["format"], 3)
        self.assertIn(
            "tlpkg/texlive.tlpdb", {item["path"] for item in manifest["files"]}
        )
        self.assertEqual(
            manifest["aliases"],
            [
                {
                    "path": "archive/payload.tar.xz",
                    "target": "archive/payload.r1.tar.xz",
                }
            ],
        )
        alias = snapshot / "tlnet/archive/payload.tar.xz"
        target = snapshot / "tlnet/archive/payload.r1.tar.xz"
        self.assertFalse(alias.is_symlink())
        self.assertEqual(alias.stat().st_ino, target.stat().st_ino)
        self.assertEqual(alias.read_bytes(), b"payload")

    def test_snapshot_alias_must_be_an_internal_hardlink(self):
        def download(_url, target, expected_size=None):
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"payload")

        with (
            mock.patch.object(
                mirror, "verified_metadata", side_effect=self.fake_metadata
            ),
            mock.patch.object(mirror, "curl_download", side_effect=download),
        ):
            result = mirror.sync(
                self.config,
                "2026-09-07",
                dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc),
            )
        snapshot = self.root / "snapshots" / result["snapshotId"]
        manifest = json.loads((snapshot / ".snapshot.json").read_text())
        alias = snapshot / "tlnet/archive/payload.tar.xz"
        outside = Path(self.temp.name) / "outside-archive"
        outside.write_bytes(b"payload")
        alias.parent.chmod(0o755)
        alias.unlink()
        alias.symlink_to(outside)
        with self.assertRaises(mirror.StateError):
            mirror.validate_snapshot_payload(snapshot, manifest)

    def test_delete_crash_state_is_reconciled(self):
        old, _ = self.publish(1, hours_ago=100)
        latest, _ = self.publish(2)
        old_path = self.root / "snapshots" / old
        old_path.chmod(0o700)
        state = mirror.load_state(self.config)
        state["snapshots"][old]["status"] = "deleting"
        mirror.save_state(self.config, state)
        # The last enumerated directory must not accidentally become the
        # chmod target when a different snapshot's deletion is recovered.
        original_iterdir = Path.iterdir
        snapshot_root = self.root / "snapshots"

        def ordered_iterdir(path):
            if path == snapshot_root:
                return iter([old_path, snapshot_root / latest])
            return original_iterdir(path)

        with mock.patch.object(Path, "iterdir", ordered_iterdir):
            mirror.reconcile_state(self.config, mirror.load_state(self.config))
        self.assertEqual(old_path.stat().st_mode & 0o777, 0o555)
        result = mirror.gc(self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc))
        self.assertIn(old, result["deletedSnapshots"])
        self.assertNotIn(old, mirror.load_state(self.config)["snapshots"])

    def test_gc_moves_a_readonly_snapshot_root_to_trash(self):
        old, _ = self.publish(1, hours_ago=100)
        self.publish(2)
        (self.root / "snapshots" / old).chmod(0o555)
        result = mirror.gc(self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc))
        self.assertIn(old, result["deletedSnapshots"])
        self.assertFalse((self.root / "snapshots" / old).exists())

    def test_enospc_never_publishes_incomplete_snapshot(self):
        latest, _ = self.publish(1)
        with (
            mock.patch.object(
                mirror, "verified_metadata", side_effect=self.fake_metadata
            ),
            mock.patch.object(
                mirror, "curl_download", side_effect=OSError(errno.ENOSPC, "full")
            ),
        ):
            with self.assertRaises(OSError):
                mirror.sync(
                    self.config,
                    "2026-09-07",
                    dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc),
                )
        state = mirror.load_state(self.config)
        self.assertEqual(state["latest"], latest)
        self.assertEqual(len(state["snapshots"]), 1)

    def test_protected_only_capacity_shortage_is_blocked(self):
        latest, _ = self.publish(1)
        high = {
            "managedBytes": 14 * mirror.GIB,
            "filesystemFreeBytes": 10 * mirror.GIB,
            "osFilesystemFreeBytes": 10 * mirror.GIB,
            "inodeFree": 100,
            "inodeTotal": 200,
        }
        with (
            mock.patch.object(
                mirror, "verified_metadata", side_effect=self.fake_metadata
            ),
            mock.patch.object(mirror, "filesystem_metrics", return_value=high),
        ):
            with self.assertRaises(mirror.CapacityBlocked):
                mirror.sync(
                    self.config,
                    "2026-09-07",
                    dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc),
                )
        self.assertEqual(mirror.load_state(self.config)["latest"], latest)

    def test_hardlink_is_counted_once_and_survives_old_snapshot_delete(self):
        old, first = self.publish(1, hours_ago=100)
        new, second = self.publish(2, shared=first)
        self.assertEqual(first.stat().st_ino, second.stat().st_ino)
        result = mirror.gc(self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc))
        self.assertIn(old, result["deletedSnapshots"])
        self.assertEqual(second.read_bytes(), b"content")

    def test_actual_space_is_remeasured_after_delete(self):
        self.publish(1, hours_ago=100)
        self.publish(2)
        with mock.patch.object(
            mirror,
            "filesystem_metrics",
            side_effect=[
                {
                    "managedBytes": 12,
                    "filesystemFreeBytes": 10,
                    "inodeFree": 1,
                    "inodeTotal": 2,
                },
                {
                    "managedBytes": 8,
                    "filesystemFreeBytes": 14,
                    "inodeFree": 1,
                    "inodeTotal": 2,
                },
                {
                    "managedBytes": 8,
                    "filesystemFreeBytes": 14,
                    "inodeFree": 1,
                    "inodeTotal": 2,
                },
            ],
        ) as metrics:
            result = mirror.gc(
                self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc)
            )
        self.assertGreaterEqual(metrics.call_count, 2)
        self.assertEqual(result["freedBytes"], 4)

    def test_corrupt_state_fails_closed(self):
        (self.root / "state/state.json").write_text("{")
        with self.assertRaises(mirror.StateError):
            mirror.gc(self.config)

    def test_semantically_corrupt_state_does_not_delete_latest(self):
        latest, _ = self.publish(1, hours_ago=100)
        state_path = self.root / "state/state.json"
        state = json.loads(state_path.read_text())
        state["snapshots"][latest]["year"] = 2025
        state_path.write_text(json.dumps(state))
        with self.assertRaises(mirror.StateError):
            mirror.gc(self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc))
        self.assertTrue((self.root / "snapshots" / latest).is_dir())

    def test_manifest_path_traversal_is_rejected(self):
        snapshot_id, _ = self.publish(1)
        manifest_path = self.root / "snapshots" / snapshot_id / ".snapshot.json"
        manifest = json.loads(manifest_path.read_text())
        manifest["files"][0]["path"] = "../../outside"
        manifest_path.write_text(json.dumps(manifest))
        state = mirror.load_state(self.config)
        with self.assertRaises(mirror.StateError):
            mirror.existing_checksum_index(self.config, state)

    def test_legacy_state_without_canonical_dates_is_migrated_in_memory(self):
        latest, _ = self.publish(1)
        state_path = self.root / "state/state.json"
        state = json.loads(state_path.read_text())
        del state["snapshots"][latest]["canonicalDates"]
        state_path.write_text(json.dumps(state))
        loaded = mirror.load_state(self.config)
        self.assertEqual(loaded["snapshots"][latest]["canonicalDates"], ["2026-09-01"])

    def test_gc_reconciles_stale_latest_file_after_delete_crash(self):
        old, _ = self.publish(1, hours_ago=100, year=2025)
        state = mirror.load_state(self.config)
        state["latest"] = None
        state["snapshots"][old]["status"] = "deleting"
        mirror.save_state(self.config, state)
        latest_file = self.root / "latest.json"
        mirror.atomic_json(latest_file, {"snapshotId": old}, 0o644)
        mirror.gc(self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc))
        self.assertFalse(latest_file.exists())

    def test_external_symlink_and_path_traversal_are_never_deleted(self):
        outside = Path(self.temp.name) / "outside"
        outside.mkdir()
        marker = outside / "keep"
        marker.write_text("yes")
        (self.root / "trash/evil").symlink_to(outside)
        with self.assertRaises(mirror.StateError):
            mirror.gc(self.config)
        self.assertEqual(marker.read_text(), "yes")
        with self.assertRaises(mirror.StateError):
            mirror.safe_child(self.root / "snapshots", "../outside")

    def test_recursive_delete_refuses_nested_external_symlink(self):
        outside = Path(self.temp.name) / "outside-tree"
        outside.mkdir()
        marker = outside / "keep"
        marker.write_text("yes")
        tree = (
            self.root / "trash" / f"staging-safe.{int(dt.datetime.now().timestamp())}"
        )
        tree.mkdir()
        (tree / "escape").symlink_to(outside)
        with self.assertRaises(mirror.StateError):
            mirror.drain_trash(self.config)
        self.assertEqual(marker.read_text(), "yes")

    def test_old_year_becomes_collectable_without_affecting_external_registry(self):
        old, _ = self.publish(1, hours_ago=100, year=2025)
        self.publish(2)
        registry = Path(self.temp.name) / "ghcr-state"
        registry.write_text("untouched")
        self.assertIn(
            old,
            mirror.gc(self.config, dt.datetime(2026, 9, 7, tzinfo=dt.timezone.utc))[
                "deletedSnapshots"
            ],
        )
        self.assertEqual(registry.read_text(), "untouched")

    def test_application_hard_limit_blocks_before_sync_and_latest_stays(self):
        latest, _ = self.publish(1)
        high = {
            "managedBytes": 15 * mirror.GIB,
            "filesystemFreeBytes": 10 * mirror.GIB,
            "osFilesystemFreeBytes": 10 * mirror.GIB,
            "inodeFree": 1000,
            "inodeTotal": 2000,
        }
        with mock.patch.object(mirror, "filesystem_metrics", return_value=high):
            with self.assertRaises(mirror.CapacityBlocked):
                mirror.sync(self.config, "2026-09-07")
        self.assertEqual(mirror.load_state(self.config)["latest"], latest)

    def test_dependency_resolution_expands_only_enabled_arch(self):
        packages = {
            "collection-basic": mirror.Package(
                "collection-basic",
                "1",
                ["engine.ARCH", "common"],
                None,
                None,
                None,
                None,
                None,
                None,
            ),
            "engine.x86_64-linux": mirror.Package(
                "engine.x86_64-linux", "1", [], "a" * 128, 1, None, None, None, None
            ),
            "engine.aarch64-linux": mirror.Package(
                "engine.aarch64-linux", "1", [], "b" * 128, 1, None, None, None, None
            ),
            "common": mirror.Package(
                "common", "1", [], "c" * 128, 1, None, None, None, None
            ),
        }
        selected = mirror.dependency_closure(packages, ["collection-basic"], ("amd64",))
        self.assertIn("engine.x86_64-linux", selected)
        self.assertNotIn("engine.aarch64-linux", selected)

    def test_arch_dependency_is_conditional_but_plain_missing_dependency_is_not(self):
        packages = {
            "texworks": mirror.Package(
                "texworks",
                "1",
                ["texworks.ARCH", "helper.windows"],
                "a" * 128,
                1,
                None,
                None,
                None,
                None,
            ),
            "texworks.windows": mirror.Package(
                "texworks.windows", "1", [], "b" * 128, 1, None, None, None, None
            ),
        }
        self.assertEqual(
            mirror.dependency_closure(packages, ["texworks"], ("amd64",)), {"texworks"}
        )
        self.assertEqual(
            mirror.dependency_closure(packages, ["texworks"], ("arm64",)), {"texworks"}
        )
        with self.assertRaises(mirror.VerificationError):
            mirror.dependency_closure(packages, ["missing"], ("amd64",))


if __name__ == "__main__":
    unittest.main()
