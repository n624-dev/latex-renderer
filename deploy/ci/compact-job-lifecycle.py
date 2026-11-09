"""Real public API/Worker lifecycle on a sealed disposable CI host only."""
import hashlib
import http.client
import io
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlparse
import uuid
import zipfile


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, timeout=180, **kwargs).stdout


def guard():
    if sys.flags.optimize:
        raise RuntimeError("CI safety assertions must remain enabled")
    assert os.geteuid() == 0 and os.environ.get("GITHUB_ACTIONS") == "true"
    assert os.environ.get("RUNNER_ENVIRONMENT") == "github-hosted"
    marker = Path("/etc/latex-renderer-ci-host.json")
    assert marker.stat().st_uid == 0 and not marker.stat().st_mode & 0o077
    proof = json.loads(marker.read_text())
    assert proof["runId"] == os.environ["GITHUB_RUN_ID"]
    assert proof["bootId"] == Path("/proc/sys/kernel/random/boot_id").read_text().strip()
    assert str(Path(__file__).resolve()).startswith(("/home/runner/work/", "/opt/latex-renderer/releases/"))


class Fixture:
    def __init__(self):
        guard()
        self.source = Path("/opt/latex-renderer/current")
        self.root = Path(tempfile.mkdtemp(prefix="latex-compact-jobs-", dir="/var/lib/latex-renderer"))
        self.uid = int(run(["id", "-u", "latex-renderer"]).strip())
        self.gid = int(run(["id", "-g", "latex-renderer"]).strip())
        os.chown(self.root, self.uid, self.gid)
        pepper = self.root / "pepper"
        shutil.copyfile("/etc/latex-renderer/secrets/api-key-pepper", pepper)
        os.chown(pepper, self.uid, self.gid)
        pepper.chmod(0o400)
        self.prefix = ["/usr/sbin/runuser", "-u", "latex-renderer", "--", "/usr/bin/env", "-i",
                       "PATH=/usr/local/bin:/usr/bin:/bin", f"LATEX_RENDERER_ADMIN_GID={self.gid}",
                       "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3", "API_KEY_PEPPER_ID=v1",
                       f"API_KEY_PEPPER_FILE={pepper}", "/usr/local/bin/node",
                       str(self.source / "apps/admin-local/dist/index.js"), "smoke-key"]
        self.jobs = []
        self.key = None
        self.origin = urlparse(next(line.split("=", 1)[1] for line in Path("/etc/latex-renderer/renderer.env").read_text().splitlines()
                                   if line.startswith("PUBLIC_ORIGIN=")))
        assert self.origin.scheme == "https" and self.origin.hostname == "latex-renderer-ci.test"
        self.context = ssl.create_default_context(cafile="/usr/local/share/ca-certificates/latex-renderer-ci.crt")

    def start(self):
        owner = run(["/usr/sbin/runuser", "-u", "latex-renderer", "--", "/usr/bin/sqlite3",
                     "/var/lib/latex-renderer/renderer.sqlite3",
                     "SELECT id FROM users WHERE role='owner' AND status='active' ORDER BY created_at,id LIMIT 1"]).decode().strip()
        assert owner.startswith("user_")
        self.key = json.loads(run([*self.prefix, "create", "--owner-id", owner, "--yes"]))
        return self

    def request(self, method, path, token=None, payload=None, binary=False, allowed=(200, 201, 202, 204), timeout=70):
        target = urlparse(path)
        if target.netloc:
            assert (target.scheme, target.netloc) == (self.origin.scheme, self.origin.netloc)
            path = target.path + ("?" + target.query if target.query else "")
        assert path.startswith("/api/v1/")
        headers = {"Authorization": "Bearer " + (token or self.key["token"]), "Cache-Control": "no-store"}
        body = None
        if payload is not None:
            body = payload if binary else json.dumps(payload).encode()
            headers["Content-Type"] = "application/zip" if binary else "application/json"
            headers["Idempotency-Key"] = "compact-ci-" + uuid.uuid4().hex
        connection = http.client.HTTPSConnection(self.origin.hostname, self.origin.port or 443, context=self.context, timeout=timeout)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read(32 * 1024 * 1024 + 1)
            assert len(data) <= 32 * 1024 * 1024
            assert response.status in allowed, f"CI {method} failed with HTTP {response.status}"
            return response.status, data
        finally:
            connection.close()

    def json(self, method, path, token=None, payload=None):
        return json.loads(self.request(method, path, token, payload)[1])

    def upload(self, slow=False, biber=False):
        text = (r"\documentclass{ltjsarticle}\begin{document}日本語 $x^2+y^2=z^2$."
                + (r"\directlua{local t=os.clock(); while os.clock()-t<20 do end}" if slow else "")
                + r"\newpage Second page. $a+b=c$.\end{document}")
        if biber:
            text = (r"\documentclass{article}\usepackage{biblatex}\addbibresource{refs.bib}"
                    r"\begin{document}Hello \cite{qa}.\printbibliography\end{document}")
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
            zipped.writestr("main.tex", text)
            if biber:
                zipped.writestr("refs.bib", '@book{qa,author={Case, Jane},title={Biber QA},year={2026},publisher={Fixture Press}}')
        data = archive.getvalue()
        ticket = self.json("POST", "/api/v1/source-tickets", payload={"size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
        if ticket["uploadRequired"]:
            self.request("PUT", ticket["uploadUrl"], ticket["uploadTicket"], data, binary=True)
        return ticket["sourceId"]

    def queue(self, source, svg=False):
        ticket = self.json("POST", "/api/v1/render-tickets", payload={"sourceId": source, "entrypoint": "main.tex", "outputs": ["pdf", "svg"] if svg else ["pdf"]})
        self.jobs.append(ticket)
        return ticket

    def wait(self, ticket, wanted=None, timeout=240):
        started = time.monotonic()
        while time.monotonic() - started < timeout:
            job = self.json("GET", f"/api/v1/jobs/{ticket['jobId']}", ticket["jobTicket"])
            if (wanted is None and job["status"] not in ("queued", "validating", "running")) or job["status"] == wanted:
                return job
            time.sleep(.5)
        raise RuntimeError("CI Job lifecycle did not settle within its bounded wait")

    def idle(self):
        if os.environ.get("CI_COMPACT_JOB_WAIT_IDLE") == "false" or "WORKER_IDLE_ENABLED=false" in Path("/etc/latex-renderer/renderer.env").read_text().splitlines():
            return
        deadline = time.monotonic() + 130
        while time.monotonic() < deadline:
            state = run(["/usr/bin/systemctl", "show", "latex-renderer-worker.service", "--property=ActiveState", "--value"]).strip()
            if state == b"inactive":
                return
            time.sleep(1)
        raise RuntimeError("Worker did not return to idle")

    def wait_cleanup(self, ticket):
        # A terminal Job can still own a cleanup lease. Do not classify that
        # legitimate interval as a recovery failure or start another attempt.
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            result = json.loads(run(["/usr/sbin/runuser", "-u", "latex-renderer", "--", "/usr/bin/python3", "-B", "-c", """
import sqlite3,sys,json
with sqlite3.connect('file:/var/lib/latex-renderer/renderer.sqlite3?mode=ro',uri=True) as db:
    lease=db.execute('SELECT lease_owner FROM jobs WHERE id=?',(sys.argv[1],)).fetchone()
    assert lease is not None
    readers=db.execute('SELECT COUNT(*) FROM source_tree_readers WHERE job_id=?',(sys.argv[1],)).fetchone()[0]
    print(json.dumps([lease[0],readers]))
""", ticket["jobId"]]))
            if result == [None, 0]:
                return
            time.sleep(1)
        raise RuntimeError("Interrupted Job cleanup did not settle")

    def close(self):
        failures = []
        if self.key:
            for ticket in self.jobs:
                try:
                    self.request("DELETE", f"/api/v1/jobs/{ticket['jobId']}", ticket["jobTicket"])
                except Exception as error:
                    failures.append(error)
            try:
                run([*self.prefix, "revoke", "--key-id", self.key["keyId"], "--service-account", self.key["serviceAccountId"], "--yes"])
            except Exception as error:
                failures.append(error)
        shutil.rmtree(self.root)
        if failures:
            raise RuntimeError("Disposable Job fixture cleanup failed") from failures[0]


def verify_mode_transition():
    guard()
    fixture = Fixture()
    path = Path("/etc/latex-renderer/renderer.env")
    before = path.read_text()
    keys = {"HTTP_IDLE_ENABLED", "HTTP_IDLE_TIMEOUT_SECONDS", "WORKER_IDLE_ENABLED",
            "WORKER_IDLE_TIMEOUT_SECONDS", "MANAGER_IDLE_TIMEOUT_SECONDS", "RENDERER_RUNTIME_MODE"}
    base = "\n".join(line for line in before.splitlines() if line.split("=", 1)[0] not in keys)
    command = ["/usr/local/bin/node", str(fixture.source / "deploy/scripts/http-services.mjs"), "reconcile"]
    def reconcile():
        return subprocess.run(command, check=True, capture_output=True, timeout=16 * 60).stdout
    stop = threading.Event()
    attempted = threading.Event()
    traffic = {"attempts": 0, "successes": 0, "unavailable": 0}
    errors = []
    def poll():
        while not stop.is_set():
            traffic["attempts"] += 1
            attempted.set()
            try:
                status, _ = fixture.request("GET", "/api/v1/projects?pageSize=1",
                                            allowed=(200, 502, 503, 504), timeout=3)
                traffic["successes" if status == 200 else "unavailable"] += 1
            except (OSError, http.client.HTTPException):
                traffic["unavailable"] += 1
            except Exception as error:
                errors.append(type(error).__name__)
                return
            stop.wait(.05)
    thread = None
    try:
        path.write_text(base + "\nHTTP_IDLE_ENABLED=true\nHTTP_IDLE_TIMEOUT_SECONDS=30\n"
                        "WORKER_IDLE_ENABLED=false\nWORKER_IDLE_TIMEOUT_SECONDS=30\n"
                        "RENDERER_RUNTIME_MODE=classic\nMANAGER_IDLE_TIMEOUT_SECONDS=30\n")
        reconcile()
        fixture.start()
        fixture.json("GET", "/api/v1/projects?pageSize=1")
        thread = threading.Thread(target=poll)
        thread.start()
        assert attempted.wait(5), "Concurrent Projects request did not start"
        path.write_text(base + "\nHTTP_IDLE_ENABLED=true\nHTTP_IDLE_TIMEOUT_SECONDS=30\n"
                        "WORKER_IDLE_ENABLED=true\nWORKER_IDLE_TIMEOUT_SECONDS=30\n"
                        "RENDERER_RUNTIME_MODE=compact\nMANAGER_IDLE_TIMEOUT_SECONDS=30\n")
        reconcile()
        stop.set()
        thread.join(10)
        assert not thread.is_alive() and not errors
        fixture.json("GET", "/api/v1/projects?pageSize=1")
        for name in ("image-manager", "internal-api", "standalone-gateway"):
            state = run(["/usr/bin/systemctl", "show", f"latex-renderer-{name}.socket",
                         "--property=ActiveState", "--value"]).strip()
            assert state == b"active", f"{name} listener did not resume"
        assert fixture.wait(fixture.queue(fixture.upload()))["status"] == "succeeded"
        return {"concurrentProjects": traffic, "listenersResumed": True, "renderSucceeded": True}
    finally:
        stop.set()
        if thread is not None:
            thread.join(10)
            assert not thread.is_alive()
        try:
            path.write_text(before)
            reconcile()
        finally:
            fixture.close()


def verify():
    guard()
    result = {"idleBoundaryVerified": os.environ.get("CI_COMPACT_JOB_WAIT_IDLE") != "false"}
    fixture = Fixture()
    try:
        fixture.start()
        source = fixture.upload()
        started = time.monotonic()
        batch = [fixture.queue(source, svg=index == 0) for index in range(3)]
        completed = [fixture.wait(ticket) for ticket in batch]
        assert all(job["status"] == "succeeded" for job in completed)
        result["threeJobBurstSeconds"] = time.monotonic() - started
        assert fixture.wait(fixture.queue(fixture.upload(biber=True)))["status"] == "succeeded"
        result["biberPdfPassed"] = True
        ticket = batch[0]
        pdf = next(item for item in completed[0]["artifacts"] if item["type"] == "pdf")
        assert any(item["type"] == "svg" for item in completed[0]["artifacts"])
        assert not any(item["relativePath"] == "previews/page-2.png" for item in completed[0]["previews"])
        fixture.idle()
        started = time.monotonic()
        for _ in range(6):
            status, png = fixture.request("GET", f"/api/v1/jobs/{ticket['jobId']}/previews/page-2.png", ticket["jobTicket"], allowed=(200, 503))
            if status == 200:
                break
            time.sleep(1)
        assert status == 200 and png.startswith(b"\x89PNG\r\n\x1a\n")
        result["lazyPageTwoSeconds"] = time.monotonic() - started
        fixture.idle()
        # Explicit synthetic SVG-stage failure, scoped to this completed CI Job.
        # Retry still uses the public authenticated path and the real renderer.
        run(["/usr/sbin/runuser", "-u", "latex-renderer", "--", "/usr/bin/python3", "-B", "-c", """
import sqlite3,sys
with sqlite3.connect('/var/lib/latex-renderer/renderer.sqlite3') as db:
    assert db.execute('SELECT status,lease_owner FROM jobs WHERE id=?',(sys.argv[1],)).fetchone()==('succeeded',None)
    db.execute("UPDATE jobs SET status='failed' WHERE id=?",(sys.argv[1],))
    db.execute("UPDATE job_output_stages SET svg_status='failed' WHERE job_id=?",(sys.argv[1],))
""", ticket["jobId"]])
        started = time.monotonic()
        retried = fixture.json("POST", "/api/v1/render-tickets", payload={"retrySvgJobId": ticket["jobId"]})
        assert retried["jobId"] == ticket["jobId"]
        after = fixture.wait(retried)
        assert after["status"] == "succeeded"
        assert next(item["sha256"] for item in after["artifacts"] if item["type"] == "pdf") == pdf["sha256"]
        result["svgRetrySeconds"] = time.monotonic() - started
        slow = fixture.upload(slow=True)
        canceled = fixture.queue(slow)
        fixture.wait(canceled, "running")
        fixture.request("POST", f"/api/v1/jobs/{canceled['jobId']}/cancel", canceled["jobTicket"])
        assert fixture.wait(canceled)["status"] == "canceled"
        result["cancelPassed"] = True
        interrupted = fixture.queue(slow)
        fixture.wait(interrupted, "running")
        run(["/usr/bin/systemctl", "kill", "--signal=KILL", "--kill-whom=all", "latex-renderer-worker.service"])
        recovered = fixture.wait(interrupted, timeout=360)
        assert recovered["status"] in ("succeeded", "failed")
        fixture.wait_cleanup(interrupted)
        worker_uid = int(run(["id", "-u", "latex-render-worker"]).strip())
        remaining = run(["/usr/sbin/runuser", "-u", "latex-render-worker", "--", "/usr/bin/env", "-i",
                         "PATH=/usr/bin:/bin", "HOME=/var/lib/latex-render-worker",
                         f"DOCKER_HOST=unix:///run/user/{worker_uid}/docker.sock", "/usr/bin/docker", "ps", "-aq",
                         "--filter", f"label=latex-renderer.job={interrupted['jobId']}"])
        assert not remaining.strip(), "Interrupted Job retained a container"
        assert fixture.wait(fixture.queue(source))["status"] == "succeeded"
        result["crashRecoveryPassed"] = True
        fixture.idle()
        return result
    finally:
        fixture.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["--mode-transition"]:
        print(json.dumps({"event": "compact_mode_transition.passed", **verify_mode_transition()}))
    else:
        assert not sys.argv[1:]
        print(json.dumps({"event": "compact_job_lifecycle.passed", **verify()}))
