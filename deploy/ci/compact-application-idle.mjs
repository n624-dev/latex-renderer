import assert from "node:assert/strict";
import { readFile, writeFile, lstat } from "node:fs/promises";
import { execFileSync, spawn } from "node:child_process";
import { request } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { performance } from "node:perf_hooks";
import { httpServiceStatus } from "../scripts/http-services.mjs";
import {
  workerEngineCommand,
  acquireEngineLock,
} from "../scripts/on-demand-engine.mjs";
import { idleContainerEngine } from "../scripts/idle-container-engine.mjs";
import { runtimeEnvironment } from "../scripts/runtime-mode.mjs";
import { retryCiMutation } from "./retry-ci-mutation.mjs";

const run = (command, args, timeout = 180000) =>
  execFileSync(command, args, {
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
  });
const roles = [
  "api",
  "web",
  "admin-api",
  "internal-api",
  "remote-mcp",
  "standalone-gateway",
  "worker",
  "image-manager",
  "update-manager",
];
const units = roles.map((name) => `latex-renderer-${name}.service`);

async function until(check, message, timeout = 120000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    assert(Date.now() < deadline, typeof message === "function" ? message() : message);
    await delay(1000);
  }
}
async function processSnapshot() {
  const values = [];
  for (const name of units) {
    const status = httpServiceStatus(name);
    const pid = Number(
      run("/usr/bin/systemctl", [
        "show",
        "--property=MainPID",
        "--value",
        status.service,
      ]).trim(),
    );
    let pssBytes = 0,
      rssBytes = 0;
    if (pid) {
      const text = await readFile(`/proc/${pid}/smaps_rollup`, "utf8");
      pssBytes = Number(/^Pss:\s+(\d+) kB$/m.exec(text)?.[1]) * 1024;
      rssBytes = Number(/^Rss:\s+(\d+) kB$/m.exec(text)?.[1]) * 1024;
      assert(Number.isFinite(pssBytes) && Number.isFinite(rssBytes));
    }
    values.push({ name, state: status.state, pid, pssBytes, rssBytes });
  }
  return values;
}
async function warmManagers() {
  const imageToken = (
    await readFile("/etc/latex-renderer/secrets/image-manager-token", "utf8")
  ).trim();
  const image = await globalThis.fetch("http://127.0.0.1:3110/v1/state", {
    headers: { Authorization: `Bearer ${imageToken}` },
    signal: globalThis.AbortSignal.timeout(30000),
  });
  assert.equal(image.status, 200);
  await image.text();
  const token = (
    await readFile("/etc/latex-renderer/secrets/update-manager-token", "utf8")
  ).trim();
  await new Promise((resolve, reject) => {
    const call = request(
      {
        socketPath: "/run/latex-renderer/update-manager.sock",
        path: "/v1/state",
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30000,
      },
      (response) => {
        response.resume();
        response.once("error", reject);
        response.once("end", () =>
          response.statusCode === 200
            ? resolve()
            : reject(new Error("Compact Updater did not wake")),
        );
      },
    );
    call.once("error", reject);
    call.once("timeout", () => call.destroy(new Error("Updater wake timeout")));
    call.end();
  });
}

async function verifyBuildProtection(image, environment) {
  let startLock;
  await until(async () => {
    try {
      startLock = await acquireEngineLock();
      return true;
    } catch (error) {
      if (error.code === "ENGINE_BUSY") return false;
      throw error;
    }
  }, "Engine initialization remained busy");
  workerEngineCommand("/usr/bin/systemctl", [
    "--user",
    "start",
    "docker.service",
  ]);
  const uid = Number(run("/usr/bin/id", ["-u", "latex-render-worker"]).trim());
  const tag = `latex-compact-build-fixture:${process.pid}`;
  const baseTag = `latex-compact-build-base:${process.pid}`;
  workerEngineCommand("/usr/bin/docker", ["image", "tag", image, baseTag]);
  const child = spawn(
    "/usr/sbin/runuser",
    [
      "-u",
      "latex-render-worker",
      "--",
      "/usr/bin/env",
      "-i",
      "PATH=/usr/local/bin:/usr/bin:/bin",
      "HOME=/var/lib/latex-render-worker",
      "BUILDX_CONFIG=/var/lib/latex-render-worker/.docker/buildx-worker",
      `DOCKER_HOST=unix:///run/user/${uid}/docker.sock`,
      "/usr/bin/docker",
      "buildx",
      "--builder",
      "default",
      "build",
      "--pull=false",
      "--network=none",
      "--no-cache",
      "--tag",
      tag,
      "-",
    ],
    { detached: true, stdio: ["pipe", "ignore", "pipe"] },
  );
  let buildDiagnostic = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    buildDiagnostic = (buildDiagnostic + chunk).slice(-8192);
  });
  const completed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  void completed.catch(() => {});
  child.stdin.on("error", () => {});
  child.stdin.end(`FROM ${baseTag}\nRUN sleep 45\n`);
  const running = () =>
    workerEngineCommand("/usr/bin/docker", [
      "buildx",
      "--builder",
      "default",
      "history",
      "ls",
      "--format",
      "{{.Status}}",
    ])
      .trim()
      .split("\n")
      .includes("Running");
  const kill = () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null)
      return;
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  try {
    await until(
      () => {
        if (child.exitCode !== null)
          throw new Error(`Build protection fixture exited ${child.exitCode}: ${buildDiagnostic}`);
        return running();
      },
      () => `Known build did not appear in BuildKit history: ${buildDiagnostic}`,
      30000,
    );
    await startLock.release();
    startLock = undefined;
    await until(
      async () => {
        const blocked = await idleContainerEngine({ environment });
        return ["builds", "containers"].includes(blocked.state);
      },
      "Engine collector did not protect an independent active build",
      15000,
    );
    assert.equal(
      workerEngineCommand("/usr/bin/systemctl", [
        "--user",
        "show",
        "--property=ActiveState",
        "--value",
        "docker.service",
      ]).trim(),
      "active",
    );
    kill();
    await completed;
    await until(
      () => !running(),
      "Interrupted BuildKit work did not settle",
      90000,
    );
    return { protected: true, interruptedBuildSettled: true };
  } finally {
    kill();
    await completed.catch(() => {});
    // Tag removal is an engine operation too. Exclude idle collection during
    // cleanup instead of racing the real timer after the build has settled.
    if (!startLock) await until(async () => {
      try { startLock = await acquireEngineLock(); return true; }
      catch (error) { if (error.code === "ENGINE_BUSY") return false; throw error; }
    }, "Engine fixture cleanup remained busy");
    try {
      workerEngineCommand("/usr/bin/systemctl", ["--user", "start", "docker.service"]);
      for (const reference of [tag, baseTag]) {
        const retained = workerEngineCommand("/usr/bin/docker", [
          "image", "ls", "--filter", `reference=${reference}`, "--quiet",
        ]).trim();
        if (retained) workerEngineCommand("/usr/bin/docker", ["image", "rm", reference]);
      }
    } finally {
      await startLock?.release();
    }
  }
}

export async function verifyCompactApplicationIdle() {
  assert.equal(process.getuid(), 0);
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  const markerPath = "/etc/latex-renderer-ci-host.json",
    info = await lstat(markerPath);
  assert(info.isFile() && info.uid === 0 && !(info.mode & 0o077));
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  assert.equal(marker.runId, process.env.GITHUB_RUN_ID);
  assert.equal(
    marker.bootId,
    (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
  );
  const envPath = "/etc/latex-renderer/renderer.env",
    before = await readFile(envPath, "utf8");
  const origin = /^PUBLIC_ORIGIN=(https:\/\/[^\s]+)$/m.exec(before)?.[1];
  assert(origin);
  const executable =
    "/opt/latex-renderer/current/deploy/scripts/http-services.mjs";
  const reconcile = () => retryCiMutation(() =>
    run("/usr/local/bin/node", [executable, "reconcile"], 16 * 60_000));
  const configured =
    before.replace(
      /^(?:HTTP_IDLE_ENABLED|HTTP_IDLE_TIMEOUT_SECONDS|WORKER_IDLE_ENABLED|WORKER_IDLE_TIMEOUT_SECONDS|RENDERER_RUNTIME_MODE|MANAGER_IDLE_TIMEOUT_SECONDS)=.*\n?/gm,
      "",
    ) +
    "\nHTTP_IDLE_ENABLED=true\nHTTP_IDLE_TIMEOUT_SECONDS=30\nWORKER_IDLE_ENABLED=true\nWORKER_IDLE_TIMEOUT_SECONDS=30\nRENDERER_RUNTIME_MODE=compact\nMANAGER_IDLE_TIMEOUT_SECONDS=30\n";
  let results;
  try {
    const modeTransition = JSON.parse(run(
      "/usr/bin/python3",
      ["-B", "/opt/latex-renderer/current/deploy/ci/compact-job-lifecycle.py", "--mode-transition"],
      20 * 60_000,
    ));
    assert.equal(modeTransition.listenersResumed, true);
    assert.equal(modeTransition.renderSucceeded, true);
    await writeFile(envPath, configured);
    await reconcile();
    await warmManagers();
    const warm = await processSnapshot();
    run(
      "/bin/sh",
      ["/opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh"],
      15 * 60_000,
    );
    await until(
      () => units.every((unit) => httpServiceStatus(unit).state === "idle"),
      () => `Compact application process did not become idle: ${JSON.stringify(units.map((unit) => httpServiceStatus(unit)))}`,
    );
    const asleep = await processSnapshot();
    assert(asleep.every((row) => row.pid === 0));
    // Static/public health must not wake a Node process, even while SQLite has
    // no live writer or WAL/SHM left from the previous worker connection.
    for (const path of [
      "/",
      "/docs/",
      "/downloads/client/manifest.json",
      "/health",
      "/api/v1/health",
      "/health/status",
    ]) {
      const response = await globalThis.fetch(
        new globalThis.URL(path, origin),
        { signal: globalThis.AbortSignal.timeout(10000) },
      );
      assert.equal(response.status, 200, "Passive/static request failed");
      await response.arrayBuffer();
      const after = await processSnapshot();
      assert(after.every((row) => row.pid === 0),
        `Passive/static request ${path} woke: ${JSON.stringify(after.filter((row) => row.pid !== 0))}`);
    }
    assert(
      (await processSnapshot()).every((row) => row.pid === 0),
      "Passive/static request woke an application process",
    );
    const imageState = JSON.parse(
      await readFile(
        "/var/lib/latex-renderer/image-manager/state.json",
        "utf8",
      ),
    );
    const image = imageState.current?.runtimeImageId;
    assert(/^sha256:[a-f0-9]{64}$/.test(image));
    const buildProtection = await verifyBuildProtection(image, {
      ...runtimeEnvironment(configured),
      DATABASE_PATH: "/var/lib/latex-renderer/renderer.sqlite3",
    });
    await until(
      () =>
        workerEngineCommand("/usr/bin/systemctl", [
          "--user",
          "show",
          "--property=ActiveState",
          "--value",
          "docker.service",
        ]).trim() === "inactive",
      "Compact engine did not stop",
    );
    // Exercise a maintenance-only activation without waiting 15 minutes. It
    // must consume the queued socket hint, exit successfully and leave Docker
    // asleep. An unread hint used to exhaust systemd's start limit here.
    for (let attempt = 0; attempt < 2; attempt++) {
      run("/usr/sbin/runuser", ["-u", "latex-renderer", "--", "/usr/local/bin/node", "--input-type=module", "-e", `
        import assert from 'node:assert/strict';
        import {DatabaseSync} from 'node:sqlite';
        process.umask(0o007);
        const db=new DatabaseSync('/var/lib/latex-renderer/renderer.sqlite3');
        try { db.exec('PRAGMA busy_timeout=5000');
          assert.equal(db.prepare("UPDATE system_settings SET value_json=? WHERE key='worker_maintenance'").run(JSON.stringify({completedAt:'1970-01-01T00:00:00.000Z'})).changes,1);
        } finally { db.close(); }
      `]);
      // A concurrent timer may already be finishing a no-work invocation.
      // The second start runs after it, so the forced demand is rechecked.
      for (let n = 0; n < 2; n++)
        run("/usr/bin/systemctl", ["start", "latex-renderer-worker-reconcile.service"]);
      await until(
        () => httpServiceStatus("latex-renderer-worker.service").state === "idle",
        "Maintenance-only Worker did not exit successfully",
        15000,
      );
      run("/usr/sbin/runuser", ["-u", "latex-renderer", "--", "/usr/local/bin/node", "--input-type=module", "-e", `
        import assert from 'node:assert/strict';
        import {DatabaseSync} from 'node:sqlite';
        process.umask(0o007);
        const db=new DatabaseSync('/var/lib/latex-renderer/renderer.sqlite3',{readOnly:true});
        try { const value=JSON.parse(db.prepare("SELECT value_json FROM system_settings WHERE key='worker_maintenance'").get().value_json);
          assert(Date.now()-Date.parse(value.completedAt)<30000);
        } finally { db.close(); }
      `]);
      assert.equal(workerEngineCommand("/usr/bin/systemctl", ["--user", "show", "--property=ActiveState", "--value", "docker.service"]).trim(), "inactive", "Maintenance-only activation started Docker");
    }
    const coldStart = performance.now();
    run(
      "/bin/sh",
      ["/opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh"],
      15 * 60_000,
    );
    const coldPdfPngTotalMs = performance.now() - coldStart;
    assert.equal(
      httpServiceStatus("latex-renderer-image-manager.service").state,
      "idle",
      "Rendering woke privileged image management",
    );
    assert.equal(
      httpServiceStatus("latex-renderer-update-manager.service").state,
      "idle",
      "Rendering woke update management",
    );
    const jobLifecycle = JSON.parse(run(
      "/usr/bin/python3",
      ["-B", "/opt/latex-renderer/current/deploy/ci/compact-job-lifecycle.py"],
      15 * 60_000,
    ));
    assert.equal(jobLifecycle.idleBoundaryVerified, true);
    const probeStart = performance.now();
    const probe = workerEngineCommand("/usr/bin/env", [
      "COMPACT_PROBE_ENGINE=docker",
      "/bin/sh",
      "/opt/latex-renderer/current/experiments/compact-runtime/probe.sh",
      image,
    ]);
    const peak = Number(/container_memory_peak_bytes=(\d+)/.exec(probe)?.[1]);
    assert(Number.isFinite(peak) && peak > 0);
    results = {
      warm,
      asleep,
      coldPdfPngTotalMs,
      engineProbeMs: performance.now() - probeStart,
      containerPeakBytes: peak,
      postCommitWake: true,
      passiveStatus: true,
      staticServing: true,
      managerIndependentRender: true,
      rootlessSandbox: true,
      maintenanceWake: { attempts: 2, acknowledged: true, withoutEngine: true },
      buildProtection,
      jobLifecycle,
      modeTransition,
    };
  } finally {
    await writeFile(envPath, before);
    await reconcile();
  }
  console.log(
    JSON.stringify({
      event: "compact_application_idle.passed",
      architecture: process.arch,
      ...results,
    }),
  );
}
