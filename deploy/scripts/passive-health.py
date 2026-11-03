"""One bounded HTTP request on a systemd-owned Unix connection; no daemon."""
import datetime
import json
import socket
import sqlite3
import subprocess
import os
import stat
from pathlib import Path

DB = "/var/lib/latex-renderer/renderer.sqlite3"


def service_states():
    names = ["api", "worker"]
    if os.environ.get("DEPLOYMENT_MODE") == "standalone":
        names.append("standalone-gateway")
    units = [f"latex-renderer-{name}.{kind}" for name in names
             for kind in ("service", "socket")]
    result = subprocess.run(["/usr/bin/systemctl", "show", "--no-pager",
                             "--property=Id,LoadState,ActiveState,SubState,Result,MainPID", *units],
                            check=True, capture_output=True, timeout=3, text=True,
                            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"})
    if len(result.stdout) > 16384:
        raise ValueError("Unbounded service status")
    records = {}
    for block in result.stdout.strip().split("\n\n"):
        values = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        records[values["Id"]] = values
    if set(records) != set(units):
        raise ValueError("Incomplete service status")
    return records


def role_state(records, name):
    service = records[f"latex-renderer-{name}.service"]
    listener = records[f"latex-renderer-{name}.socket"]
    if (service.get("LoadState") != "loaded" or service.get("Result") != "success"
            or listener.get("ActiveState") == "failed"):
        return "unavailable"
    if service.get("ActiveState") == "active":
        return "running"
    if (service.get("ActiveState") == "inactive" and
            listener.get("ActiveState") == "active" and listener.get("SubState") == "listening"):
        return "idle"
    return "unavailable"


def read_worker_health():
    path = "/run/latex-renderer-worker-health/state.json"
    parent = os.stat(os.path.dirname(path))
    if os.path.realpath(os.path.dirname(path)) != os.path.dirname(path) or parent.st_mode & 0o022:
        raise ValueError("Unsafe Worker health directory")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > 4096 or info.st_nlink != 1 or info.st_uid != parent.st_uid or info.st_mode & 0o022:
            raise ValueError("Unsafe Worker health record")
        return json.loads(os.read(fd, 4097))
    finally:
        os.close(fd)


def snapshot(database=DB, states=service_states, health=read_worker_health):
    now = datetime.datetime.now(datetime.timezone.utc)
    value = {"api": False, "rendering": False, "worker": "unavailable",
             "checkedAt": now.isoformat().replace("+00:00", "Z")}
    try:
        records = states()
        api = role_state(records, "api") in ("running", "idle")
        if os.environ.get("DEPLOYMENT_MODE") == "standalone":
            api = api and role_state(records, "standalone-gateway") in ("running", "idle")
        value["api"] = api
        worker = role_state(records, "worker")
        # SQLite is opened read-only. Its legitimate WAL/SHM bookkeeping may
        # need creation after the last writer checkpoints and closes.
        db = sqlite3.connect(Path(database).as_uri() + "?mode=ro", uri=True, timeout=.1)
        try:
            db.execute("PRAGMA cache_size=-256")
            settings = dict(db.execute("SELECT key,value_json FROM system_settings WHERE key IN ('worker_mode','worker_heartbeat')"))
            mode = json.loads(settings.get("worker_mode", '"running"'))
            if mode not in ("running", "paused", "draining"):
                raise ValueError("Invalid Worker mode")
            pending = db.execute("""SELECT
              EXISTS(SELECT 1 FROM jobs WHERE status IN ('queued','validating','running') OR lease_owner IS NOT NULL)
              OR EXISTS(SELECT 1 FROM job_preview_requests WHERE status IN ('queued','running') OR lease_owner IS NOT NULL)
              OR EXISTS(SELECT 1 FROM source_tree_readers)
              OR EXISTS(SELECT 1 FROM source_trees WHERE status IN ('building','deleting'))""").fetchone()[0]
            if worker == "idle" and not pending:
                value["worker"] = "idle" if mode == "running" else mode
                value["rendering"] = mode == "running"
            elif worker == "running":
                heartbeat = health()
                age = (now - datetime.datetime.fromisoformat(heartbeat["at"])).total_seconds()
                if (0 <= age <= 30 and heartbeat.get("stopping") is False and
                        str(heartbeat.get("pid")) == records["latex-renderer-worker.service"].get("MainPID")):
                    value["worker"] = mode
                    value["rendering"] = mode == "running"
        finally:
            db.close()
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error, subprocess.SubprocessError):
        value["rendering"] = False
        value["worker"] = "unavailable"
    return value


def respond(connection, inspect=snapshot):
    connection.settimeout(3)
    stream = connection.makefile("rb")
    line = b""
    try:
        line = stream.readline(4097)
        if len(line) > 4096:
            raise ValueError("Request line too long")
        method, target, protocol = line.decode("ascii").strip().split(" ")
        if protocol not in ("HTTP/1.0", "HTTP/1.1"):
            raise ValueError("Invalid HTTP version")
        total = len(line)
        for _ in range(64):
            header = stream.readline(4097)
            total += len(header)
            if total > 8192 or not header:
                raise ValueError("Invalid HTTP headers")
            if header == b"\r\n":
                break
        else:
            raise ValueError("Too many HTTP headers")
        path = target.split("?", 1)[0]
        if method not in ("GET", "HEAD"):
            code, body = 405, {"error": "METHOD_NOT_ALLOWED"}
        elif path in ("/health", "/api/v1/health"):
            code, body = 200, {"status": "ok"}
        elif path in ("/health/rendering", "/health/status"):
            body = inspect()
            code = 200 if path == "/health/status" or body["rendering"] else 503
        else:
            code, body = 404, {"error": "NOT_FOUND"}
    except (ValueError, UnicodeError, TimeoutError):
        code, body = 400, {"error": "BAD_REQUEST"}
    finally:
        stream.close()
    data = json.dumps(body, separators=(",", ":")).encode()
    reason = {200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed", 503: "Service Unavailable"}[code]
    headers = (f"HTTP/1.1 {code} {reason}\r\nContent-Type: application/json; charset=utf-8\r\n"
               f"Content-Length: {len(data)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n").encode()
    connection.sendall(headers + (b"" if line.startswith(b"HEAD ") else data))


if __name__ == "__main__":
    with socket.socket(fileno=os.dup(0)) as connection:
        try:
            respond(connection)
        except OSError:
            pass  # A disconnected health client is not a service failure.
