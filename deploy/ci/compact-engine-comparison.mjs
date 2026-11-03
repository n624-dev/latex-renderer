import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { readFile, writeFile, lstat, statfs, mkdir, copyFile, chmod } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout, clearTimeout } from "node:timers";
import { workerEngineCommand } from "../scripts/on-demand-engine.mjs";
import { quiesceProbeAccount } from "./compact-probe-cleanup.mjs";

assert.equal(process.getuid(), 0);
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
assert(resolve(process.argv[1]).startsWith("/home/runner/work/"));
const markerPath = "/etc/latex-renderer-ci-host.json",
  info = await lstat(markerPath);
assert(info.isFile() && info.uid === 0 && !(info.mode & 0o077));
const marker = JSON.parse(await readFile(markerPath, "utf8"));
assert.equal(marker.runId, process.env.GITHUB_RUN_ID);
assert.equal(
  marker.bootId,
  (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
);
const release = JSON.parse(
  await readFile(
    "/opt/latex-renderer/current/.latex-renderer-release.json",
    "utf8",
  ),
);
assert.equal(release.commit, process.env.SOURCE_COMMIT);
const state = JSON.parse(
  await readFile("/var/lib/latex-renderer/image-manager/state.json", "utf8"),
);
const image = state.current?.runtimeImageId;
assert(/^sha256:[a-f0-9]{64}$/.test(image));
const probe =
  "/opt/latex-renderer/current/experiments/compact-runtime/probe.sh";
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    timeout: 600000,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024,
    ...options,
  });
const results = {
  schemaVersion: 1,
  sourceCommit: release.commit,
  image,
  architecture: process.arch,
  docker: [],
  podman: { eligible: false },
};
for (let n = 0; n < 2; n++) {
  const started = performance.now();
  const text = workerEngineCommand("/usr/bin/env", [
    "COMPACT_PROBE_ENGINE=docker",
    "/bin/sh",
    probe,
    image,
  ]);
  const containerPeakBytes = Number(
    /container_memory_peak_bytes=(\d+)/.exec(text)?.[1],
  );
  assert(Number.isFinite(containerPeakBytes) && containerPeakBytes > 0);
  results.docker.push({
    elapsedMs: performance.now() - started,
    containerPeakBytes,
    isolationPassed: true,
  });
}

const user = "latex-render-probe";
assert.notEqual(process.env.USER, user);
const cleanupFailures = [];
let created = false,
  podman,
  podmanReady = false,
  probeUid;
try {
  // Capacity is checked before installing a second disposable image store.
  const imageBytes = Number(
    workerEngineCommand("/usr/bin/docker", [
      "image",
      "inspect",
      image,
      "--format",
      "{{.Size}}",
    ]),
  );
  assert(Number.isSafeInteger(imageBytes) && imageBytes > 0);
  const disk = await statfs("/var/lib");
  if (disk.bavail * disk.bsize < imageBytes * 1.2 + 2 * 1024 ** 3)
    throw new Error(
      "Insufficient disposable-host space for isolated Podman copy",
    );
  run("/usr/bin/apt-get", ["-o", "Acquire::Retries=2", "update"]);
  run("/usr/bin/apt-get", [
    "-o",
    "Acquire::Retries=2",
    "install",
    "--yes",
    "--no-install-recommends",
    "podman",
    "uidmap",
    "dbus-user-session",
    "fuse-overlayfs",
  ]);
  const existing = spawn("/usr/bin/id", [user], { stdio: "ignore" });
  assert.notEqual(
    await new Promise((resolve) => existing.once("close", resolve)),
    0,
    "Refusing to reuse a probe account",
  );
  run("/usr/sbin/useradd", [
    "--create-home",
    "--user-group",
    "--shell",
    "/bin/bash",
    user,
  ]);
  created = true;
  const uid = Number(run("/usr/bin/id", ["-u", user]).trim());
  assert(uid > 0);
  probeUid = uid;
  run("/usr/bin/loginctl", ["enable-linger", user]);
  run("/usr/bin/systemctl", ["start", `user@${uid}.service`]);
  // A separate account cannot traverse the application's sealed release.
  // Copy only the fixed probe and its policy, never credentials or app state.
  const fixture = `/home/${user}/fixture`;
  for (const path of [fixture, `${fixture}/experiments`, `${fixture}/experiments/compact-runtime`, `${fixture}/deploy`, `${fixture}/deploy/security`]) {
    await mkdir(path, { recursive: true, mode: 0o755 });
    await chmod(path, 0o755);
  }
  const podmanProbe = `${fixture}/experiments/compact-runtime/probe.sh`;
  await copyFile(probe, podmanProbe);
  await copyFile("/opt/latex-renderer/current/deploy/security/seccomp.json", `${fixture}/deploy/security/seccomp.json`);
  await chmod(podmanProbe, 0o444);
  await chmod(`${fixture}/deploy/security/seccomp.json`, 0o444);
  const env = [
    "PATH=/usr/local/bin:/usr/bin:/bin",
    `HOME=/home/${user}`,
    `XDG_RUNTIME_DIR=/run/user/${uid}`,
    `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`,
    `XDG_CONFIG_HOME=/home/${user}/.config`,
    `XDG_DATA_HOME=/home/${user}/.local/share`,
    `XDG_CACHE_HOME=/home/${user}/.cache`,
  ];
  const prefix = ["-u", user, "--", "/usr/bin/env", "-i", ...env];
  podman = (...args) =>
    run("/usr/sbin/runuser", [
      ...prefix,
      "/usr/bin/podman",
      "--remote=false",
      ...args,
    ]);
  assert.equal(
    podman(
      "info",
      "--format",
      "{{.Host.Security.Rootless}} {{.Host.CgroupsVersion}}",
    ).trim(),
    "true v2",
  );
  podmanReady = true;
  const worker = Number(
    run("/usr/bin/id", ["-u", "latex-render-worker"]).trim(),
  );
  const save = spawn(
    "/usr/sbin/runuser",
    [
      "-u",
      "latex-render-worker",
      "--",
      "/usr/bin/env",
      "-i",
      "PATH=/usr/bin:/bin",
      "HOME=/var/lib/latex-render-worker",
      `DOCKER_HOST=unix:///run/user/${worker}/docker.sock`,
      "/usr/bin/docker",
      "image",
      "save",
      image,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  const load = spawn(
    "/usr/sbin/runuser",
    [...prefix, "/usr/bin/podman", "--remote=false", "load"],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  const saved = new Promise((resolve, reject) => {
    save.once("error", reject);
    save.once("close", resolve);
  });
  const loaded = new Promise((resolve, reject) => {
    load.once("error", reject);
    load.once("close", resolve);
  });
  const timeout = setTimeout(() => {
    save.kill("SIGKILL");
    load.kill("SIGKILL");
  }, 300000);
  try {
    await pipeline(save.stdout, load.stdin);
    assert.equal(await saved, 0);
    assert.equal(await loaded, 0);
  } finally {
    clearTimeout(timeout);
    if (save.exitCode === null) save.kill("SIGKILL");
    if (load.exitCode === null) load.kill("SIGKILL");
    await Promise.allSettled([saved, loaded]);
  }
  assert.equal(
    podman("image", "inspect", image, "--format", "{{.Id}}")
      .trim()
      .replace(/^sha256:/, ""),
    image.slice(7),
  );
  const samples = [];
  for (let n = 0; n < 2; n++) {
    const started = performance.now();
    const text = run("/usr/sbin/runuser", [...prefix, "/bin/sh", podmanProbe, image]);
    const containerPeakBytes = Number(
      /container_memory_peak_bytes=(\d+)/.exec(text)?.[1],
    );
    assert(containerPeakBytes > 0);
    samples.push({
      elapsedMs: performance.now() - started,
      containerPeakBytes,
      isolationPassed: true,
    });
  }
  results.podman = { eligible: true, samples };
} catch (error) {
  // An experimental backend is excluded when its host/policy checks fail.
  // This never changes the supported Docker backend or relaxes its sandbox.
  results.podman = {
    eligible: false,
    classification: "probe-failed-or-unsupported",
    reason:
      error instanceof Error ? error.message.slice(0, 300) : "Probe failed",
  };
} finally {
  if (created) {
    for (const cleanup of [
      () => { if (podmanReady) podman("system", "reset", "--force"); },
      () => quiesceProbeAccount({ uid: probeUid,
        workerUid: Number(run("/usr/bin/id", ["-u", "latex-render-worker"]).trim()), run,
        alive: (uid) => {
          try { return run("/usr/bin/pgrep", ["--uid", String(uid)]).trim().length > 0; }
          catch (error) { if (error.status === 1) return false; throw error; }
        }, wait: delay }),
      () => run("/usr/sbin/userdel", ["--remove", user]),
    ]) {
      try { await cleanup(); } catch (error) { cleanupFailures.push(error); }
    }
  }
}
results.cleanup = { passed: cleanupFailures.length === 0 };
const output = resolve(
  process.env.RUNNER_TEMP,
  "compact-engine-comparison.json",
);
await writeFile(output, JSON.stringify(results, null, 2) + "\n", { mode: 0o644 });
console.log(
  JSON.stringify({ event: "compact_engine_comparison.completed", ...results }),
);
if (cleanupFailures.length)
  throw new AggregateError(cleanupFailures, "Disposable engine probe cleanup failed");
