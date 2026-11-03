"""Disposable-host comparison with real idle deadlines and bounded evidence."""
import datetime
import http.client
import json
import os
from pathlib import Path
import ssl
import socket
import subprocess
import tempfile
import time
import sys

if sys.flags.optimize:
    raise RuntimeError("CI safety assertions must remain enabled")

assert os.geteuid() == 0
assert os.environ.get("GITHUB_ACTIONS") == "true"
assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
assert os.environ.get("CI_COMPACT_MEASURE_IDLE") == "1"
assert str(Path(__file__).resolve()).startswith("/home/runner/work/")
marker_path = Path("/etc/latex-renderer-ci-host.json")
assert marker_path.stat().st_uid == 0 and not marker_path.stat().st_mode & 0o077
marker = json.loads(marker_path.read_text())
assert marker["runId"] == os.environ["GITHUB_RUN_ID"]
assert marker["bootId"] == Path("/proc/sys/kernel/random/boot_id").read_text().strip()
current = Path("/opt/latex-renderer/current")
release = json.loads((current / ".latex-renderer-release.json").read_text())
assert release["commit"] == os.environ["SOURCE_COMMIT"]
image_state_path = Path("/var/lib/latex-renderer/image-manager/state.json")
image_state = json.loads(image_state_path.read_text())
assert image_state.get("desired", {}).get("autoUpdate") is not True
image = image_state["current"]["runtimeImageId"]
env_path = Path("/etc/latex-renderer/renderer.env")
before = env_path.read_text()
report_path = Path(os.environ["RUNNER_TEMP"]) / "compact-idle-measurement.json"
assert str(report_path.resolve()).startswith("/home/runner/work/_temp/")


def command(args, timeout=120):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, "NODE_EXTRA_CA_CERTS": "/usr/local/share/ca-certificates/latex-renderer-ci.crt"}).stdout


uid = int(command(["id", "-u", "latex-render-worker"]).strip())
user_env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "HOME": "/var/lib/latex-render-worker",
            "XDG_RUNTIME_DIR": f"/run/user/{uid}", "DBUS_SESSION_BUS_ADDRESS": f"unix:path=/run/user/{uid}/bus"}


def engine_state():
    return command(["/usr/sbin/runuser", "-u", "latex-render-worker", "--", "/usr/bin/env", "-i",
                    *[f"{key}={value}" for key, value in user_env.items()], "/usr/bin/systemctl", "--user",
                    "show", "--property=ActiveState", "--value", "docker.service"]).strip()


roles = [f"latex-renderer-{name}.service" for name in
         ("api", "web", "admin-web", "admin-api", "internal-api", "remote-mcp", "standalone-gateway", "worker", "image-manager", "update-manager")]
maintenance = [f"latex-renderer-{name}.service" for name in
               ("worker-reconcile", "engine-idle", "image-operation-watchdog", "update-refresh", "image-refresh", "backup", "cleanup", "audit-export", "image-log-cleanup", "update-recovery-gc")]
ingress = ["latex-renderer-ingress.service", "nginx.service", "cloudflared.service"]


def number(value):
    try:
        result = int(value)
        return result if 0 <= result < 2 ** 63 else None
    except (ValueError, TypeError):
        return None


def process_memory(pid):
    try:
        lines = Path(f"/proc/{pid}/smaps_rollup").read_text().splitlines()
        values = dict((line.split(":", 1)[0], int(line.split()[1]) * 1024) for line in lines if line.startswith(("Pss:", "Rss:")))
        return {"pssBytes": values["Pss"], "rssBytes": values["Rss"]}
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        return None


def snapshot():
    text = command(["/usr/bin/systemctl", "show", "--no-pager",
                    "--property=Id,MainPID,ActiveState,Result,ExecMainStartTimestampMonotonic,MemoryCurrent,MemoryPeak,ControlGroup",
                    *roles, *maintenance, *ingress, f"user@{uid}.service"])
    assert len(text) < 131072
    values = {}
    for block in text.strip().split("\n\n"):
        row = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        if "Id" in row:
            pid = number(row.get("MainPID")) or 0
            values[row["Id"]] = {"pid": pid, "state": row.get("ActiveState"),
                                  "started": row.get("ExecMainStartTimestampMonotonic"),
                                  "memoryCurrentBytes": number(row.get("MemoryCurrent")),
                                  "memoryPeakBytes": number(row.get("MemoryPeak")),
                                  "processMemory": process_memory(pid) if pid else None}
    main_pids = {row["pid"] for unit, row in values.items() if unit in roles and row["pid"]}
    auxiliary = {}
    for item in Path("/proc").iterdir():
        if not item.name.isdigit() or int(item.name) in main_pids:
            continue
        try:
            status = (item / "status").read_text()
            process_uid = next(int(line.split()[1]) for line in status.splitlines() if line.startswith("Uid:"))
            cgroup = (item / "cgroup").read_text()
            if process_uid != uid and f"/user-{uid}.slice/" not in cgroup:
                continue
            name = next(line.split("\t", 1)[1] for line in status.splitlines() if line.startswith("Name:"))
            memory = process_memory(int(item.name))
            entry = auxiliary.setdefault(name, {"processes": 0, "pssBytes": 0, "rssBytes": 0, "unmeasuredProcesses": 0})
            entry["processes"] += 1
            if memory:
                entry["pssBytes"] += memory["pssBytes"]
                entry["rssBytes"] += memory["rssBytes"]
            else:
                entry["unmeasuredProcesses"] += 1
        except (FileNotFoundError, ProcessLookupError, StopIteration):
            continue
    total_pss = sum((row["processMemory"] or {}).get("pssBytes", 0) for unit, row in values.items() if unit in roles)
    return {"at": datetime.datetime.now(datetime.timezone.utc).isoformat(), "roles": values,
            "applicationProcesses": len(main_pids), "applicationPssBytes": total_pss,
            "unmeasuredApplicationProcesses": sum(row["pid"] != 0 and row["processMemory"] is None
                                                 for unit, row in values.items() if unit in roles),
            "auxiliary": auxiliary, "dedicatedEngine": engine_state()}


def configured(mode):
    activated = mode != "always"
    choices = {"HTTP_IDLE_ENABLED": str(activated).lower(), "WORKER_IDLE_ENABLED": str(activated).lower(),
               "RENDERER_RUNTIME_MODE": "compact" if mode == "compact" else "classic",
               "HTTP_IDLE_TIMEOUT_SECONDS": "900", "WORKER_IDLE_TIMEOUT_SECONDS": "900", "MANAGER_IDLE_TIMEOUT_SECONDS": "900"}
    lines = [line for line in before.splitlines() if line.split("=", 1)[0] not in choices]
    return "\n".join(lines + [f"{key}={value}" for key, value in choices.items()]) + "\n"


def reconcile():
    command(["/usr/local/bin/node", str(current / "deploy/scripts/http-services.mjs"), "reconcile"], 16 * 60)


def warm():
    for port, path in [(3100, "/health"), (3101, "/health"), (3102, "/health"), (3103, "/health"),
                       (3104, "/.well-known/oauth-authorization-server"), (3105, "/api/v1/health")]:
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
        try:
            connection.request("GET", path)
            response = connection.getresponse()
            assert response.status == 200
            response.read()
        finally:
            connection.close()
    token = Path("/etc/latex-renderer/secrets/image-manager-token").read_text().strip()
    connection = http.client.HTTPConnection("127.0.0.1", 3110, timeout=30)
    try:
        connection.request("GET", "/v1/state", headers={"Authorization": f"Bearer {token}"})
        response = connection.getresponse()
        assert response.status == 200
        response.read()
    finally:
        connection.close()
    token = Path("/etc/latex-renderer/secrets/update-manager-token").read_text().strip()
    socket_connection = socket.socket(socket.AF_UNIX)
    socket_connection.settimeout(30)
    socket_connection.connect("/run/latex-renderer/update-manager.sock")
    try:
        socket_connection.sendall(f"GET /v1/state HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n".encode())
        response = http.client.HTTPResponse(socket_connection)
        response.begin()
        assert response.status == 200
        response.read()
    finally:
        socket_connection.close()


def cpu_sample():
    return [int(value) for value in Path("/proc/stat").read_text().splitlines()[0].split()[1:9]]


def smoke():
    started = time.monotonic()
    peak_application = 0
    peak_auxiliary = 0
    cpu_before = cpu_sample()
    with tempfile.TemporaryFile(dir=os.environ["RUNNER_TEMP"]) as output:
        child = subprocess.Popen(["/bin/sh", str(current / "deploy/scripts/smoke-test-production.sh")],
                                 stdout=output, stderr=output, start_new_session=True,
                                 env={**os.environ, "NODE_EXTRA_CA_CERTS": "/usr/local/share/ca-certificates/latex-renderer-ci.crt"})
        try:
            while child.poll() is None:
                assert time.monotonic() - started < 15 * 60, "Render measurement timed out"
                assert os.fstat(output.fileno()).st_size <= 2 * 1024 * 1024, "Render diagnostic budget exceeded"
                value = snapshot()
                peak_application = max(peak_application, value["applicationPssBytes"])
                peak_auxiliary = max(peak_auxiliary, sum(row["pssBytes"] for row in value["auxiliary"].values()))
                time.sleep(.5)
            assert child.returncode == 0, "Render measurement failed"
        finally:
            if child.poll() is None:
                os.killpg(child.pid, 15)
                try:
                    child.wait(timeout=30)
                except subprocess.TimeoutExpired:
                    os.killpg(child.pid, 9)
                    child.wait(timeout=10)
    cpu_after = cpu_sample()
    delta = [new - old for new, old in zip(cpu_after, cpu_before)]
    return {"success": True, "elapsedSeconds": time.monotonic() - started,
            "observedPeakApplicationPssBytes": peak_application, "observedPeakAuxiliaryPssBytes": peak_auxiliary,
            "hostCpuBusyPercent": 100 * (sum(delta) - delta[3] - delta[4]) / max(1, sum(delta)),
            "hostIoWaitPercent": 100 * delta[4] / max(1, sum(delta))}


def first_requests():
    origin = next(line.split("=", 1)[1] for line in before.splitlines() if line.startswith("PUBLIC_ORIGIN="))
    from urllib.parse import urlparse
    url = urlparse(origin)
    timings = {}
    for name, connection, path in [
        ("staticHomeSeconds", http.client.HTTPSConnection(url.hostname, url.port or 443, timeout=30,
            context=ssl.create_default_context(cafile="/usr/local/share/ca-certificates/latex-renderer-ci.crt")), "/"),
        ("firstApiSeconds", http.client.HTTPConnection("127.0.0.1", 3100, timeout=30), "/health"),
    ]:
        started = time.monotonic()
        try:
            connection.request("GET", path)
            response = connection.getresponse()
            assert response.status == 200
            response.read()
            timings[name] = time.monotonic() - started
        finally:
            connection.close()
    return timings


report = {"schemaVersion": 1, "complete": False, "sourceCommit": release["commit"], "image": image,
          "quietSecondsPerScenario": 3600, "sampleIntervalSeconds": 5, "scenarios": []}


def save():
    temporary = report_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(report, indent=2) + "\n")
    temporary.chmod(0o644)
    temporary.replace(report_path)


try:
    for mode in ("always", "activated", "compact"):
        assert json.loads((current / ".latex-renderer-release.json").read_text())["commit"] == release["commit"]
        assert json.loads(image_state_path.read_text())["current"]["runtimeImageId"] == image
        env_path.write_text(configured(mode))
        reconcile()
        scenario = {"mode": mode, "warmup": smoke()}
        warm()
        scenario["initial"] = snapshot()
        report["scenarios"].append(scenario)
        counts = {}
        observed = {}
        node_zero = 0
        samples = 0
        minimum = None
        maximum = 0
        started = time.monotonic()
        captured15 = False
        while True:
            value = snapshot()
            samples += 1
            node_zero += value["applicationProcesses"] == 0 and value["dedicatedEngine"] == "inactive"
            minimum = value["applicationPssBytes"] if minimum is None else min(minimum, value["applicationPssBytes"])
            maximum = max(maximum, value["applicationPssBytes"])
            for unit, row in value["roles"].items():
                stamp = row["started"]
                if stamp and stamp != "0" and observed.get(unit) != stamp:
                    observed[unit] = stamp
                    counts[unit] = counts.get(unit, 0) + 1
            elapsed = time.monotonic() - started
            if elapsed >= 900 and not captured15:
                captured15 = True
                scenario["after15Minutes"] = value
                save()
                print(f"Idle measurement: {mode}, 15 minutes complete", flush=True)
            if elapsed >= 3600:
                scenario["afterOneHour"] = value
                break
            time.sleep(min(5, 3600 - elapsed))
        scenario["quietSummary"] = {"samples": samples, "zeroApplicationAndEngineSamples": node_zero,
                                    "minimumApplicationPssBytes": minimum, "maximumApplicationPssBytes": maximum,
                                    "observedInvocationsIncludingInitial": counts}
        if mode == "compact":
            assert node_zero > 0, "Compact never reached zero application processes and an inactive dedicated engine"
        scenario["firstRequestsAfterQuiet"] = first_requests()
        scenario["firstPdfPngAfterQuiet"] = smoke()
        scenario["warmPdfPng"] = smoke()
        save()
        print(f"Idle measurement: {mode}, one hour and cold/warm rendering complete", flush=True)
    report["complete"] = True
finally:
    env_path.write_text(before)
    reconcile()
    save()
