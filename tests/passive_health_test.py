import datetime
import importlib.util
from pathlib import Path
import socket
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("passive_health", Path(__file__).resolve().parents[1] / "deploy/scripts/passive-health.py")
health = importlib.util.module_from_spec(spec)
spec.loader.exec_module(health)


class PassiveHealthTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="passive-health-")
        self.addCleanup(self.temporary.cleanup)
        self.path = str(Path(self.temporary.name) / "state.sqlite3")
        self.db = sqlite3.connect(self.path)
        self.addCleanup(self.db.close)
        self.db.executescript("""CREATE TABLE jobs(status TEXT,lease_owner TEXT);
          CREATE TABLE job_preview_requests(status TEXT,lease_owner TEXT);
          CREATE TABLE source_tree_readers(id TEXT); CREATE TABLE source_trees(status TEXT);
          CREATE TABLE system_settings(key TEXT,value_json TEXT);""")
        self.states = {}
        for name in ("api", "worker"):
            self.states[f"latex-renderer-{name}.service"] = {"LoadState": "loaded", "ActiveState": "inactive", "Result": "success", "MainPID": "1234"}
            self.states[f"latex-renderer-{name}.socket"] = {"ActiveState": "active", "SubState": "listening"}

    def snapshot(self):
        return health.snapshot(self.path, lambda: self.states)

    def test_idle_is_healthy_without_starting_node_or_engine(self):
        state = self.snapshot()
        self.assertTrue(state["api"])
        self.assertTrue(state["rendering"])
        self.assertEqual(state["worker"], "idle")

    def test_pending_or_cleanup_is_not_healthy_idle(self):
        for status, owner in (("queued", None), ("running", "owner"), ("failed", "cleanup")):
            with self.subTest(status=status):
                self.db.execute("INSERT INTO jobs VALUES (?,?)", (status, owner))
                self.db.commit()
                self.assertFalse(self.snapshot()["rendering"])
                self.db.execute("DELETE FROM jobs")
                self.db.commit()

    def test_standalone_health_requires_gateway_listener_or_process(self):
        with patch.dict("os.environ", {"DEPLOYMENT_MODE": "standalone"}):
            self.assertFalse(self.snapshot()["api"])
            self.states["latex-renderer-standalone-gateway.service"] = {"LoadState": "loaded", "ActiveState": "inactive", "Result": "success"}
            self.states["latex-renderer-standalone-gateway.socket"] = {"ActiveState": "active", "SubState": "listening"}
            self.assertTrue(self.snapshot()["api"])
            self.states["latex-renderer-standalone-gateway.socket"]["ActiveState"] = "failed"
            self.assertFalse(self.snapshot()["api"])

    def test_failed_missing_and_stopped_listener_are_unavailable(self):
        for state in ("failed", "inactive"):
            self.states["latex-renderer-worker.socket"]["ActiveState"] = state
            self.assertFalse(self.snapshot()["rendering"])
        self.states["latex-renderer-worker.socket"]["ActiveState"] = "active"
        self.states["latex-renderer-worker.service"]["Result"] = "exit-code"
        self.assertFalse(self.snapshot()["rendering"])

    def test_maintenance_mode_and_corrupt_state_fail_closed(self):
        self.db.execute("INSERT INTO system_settings VALUES ('worker_mode','\"paused\"')")
        self.db.commit()
        self.assertFalse(self.snapshot()["rendering"])
        self.db.execute("UPDATE system_settings SET value_json='broken'")
        self.db.commit()
        self.assertEqual(self.snapshot()["worker"], "unavailable")
        missing = str(Path(self.temporary.name) / "missing.sqlite3")
        self.assertFalse(health.snapshot(missing, lambda: self.states)["rendering"])
        self.assertFalse(Path(missing).exists())

    def test_running_requires_fresh_matching_process_health(self):
        self.states["latex-renderer-worker.service"]["ActiveState"] = "active"
        record = {"pid": 1234, "at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "stopping": False}
        inspect = lambda: health.snapshot(self.path, lambda: self.states, lambda: record)
        self.assertTrue(inspect()["rendering"])
        record["pid"] = 1235
        self.assertFalse(inspect()["rendering"])
        record["pid"] = 1234
        record["stopping"] = True
        self.assertFalse(inspect()["rendering"])

    def response(self, request):
        client, server = socket.socketpair()
        def serve():
            with server:
                health.respond(server, lambda: {"rendering": False, "worker": "unavailable"})
        thread = threading.Thread(target=serve)
        thread.start()
        try:
            client.settimeout(5)
            client.sendall(request)
            data = bytearray()
            while chunk := client.recv(4096):
                data.extend(chunk)
            return bytes(data)
        finally:
            client.close()
            thread.join(timeout=5)
            self.assertFalse(thread.is_alive())

    def test_http_surface_is_bounded_and_has_no_mutation_or_file_route(self):
        self.assertIn(b"200 OK", self.response(b"GET /health HTTP/1.1\r\nHost: fixture\r\n\r\n"))
        self.assertIn(b"503 Service Unavailable", self.response(b"GET /health/rendering HTTP/1.1\r\n\r\n"))
        self.assertIn(b"405 Method Not Allowed", self.response(b"POST /health HTTP/1.1\r\n\r\n"))
        self.assertIn(b"404 Not Found", self.response(b"GET /../../etc/passwd HTTP/1.1\r\n\r\n"))
        response = self.response(b"HEAD /health HTTP/1.1\r\n\r\n")
        self.assertTrue(response.endswith(b"\r\n\r\n"))
        self.assertIn(b"Cache-Control: no-store", response)
        self.assertIn(b"400 Bad Request", self.response(b"GET /" + b"x" * 4200 + b" HTTP/1.1\r\n\r\n"))


if __name__ == "__main__":
    unittest.main()
