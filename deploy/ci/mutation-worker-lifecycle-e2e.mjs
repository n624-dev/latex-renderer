// Fault injection is confined to private fixtures on a sealed disposable
// GitHub-hosted systemd/rootless-Docker host. No production unit is stopped.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmod,
  chown,
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { acquireMutationLockForPath } from "../scripts/mutation-lock.mjs";

if (
  process.getuid() !== 0 ||
  process.argv.length !== 2 ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted"
)
  throw new Error("Lifecycle fault injection requires a disposable CI host");
const markerPath = "/etc/latex-renderer-ci-host.json",
  info = await lstat(markerPath);
assert(info.isFile() && info.uid === 0 && !(info.mode & 0o077));
const marker = JSON.parse(await readFile(markerPath, "utf8"));
assert.equal(marker.runId, process.env.GITHUB_RUN_ID);
assert.equal(
  marker.bootId,
  (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
);
const candidate = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
assert(candidate.startsWith("/opt/latex-renderer/update-staging/ci-"));
const current = "/opt/latex-renderer/current";
assert.equal(
  JSON.parse(
    await readFile(join(current, ".latex-renderer-release.json"), "utf8"),
  ).commit,
  JSON.parse(
    await readFile(join(candidate, ".latex-renderer-release.json"), "utf8"),
  ).commit,
);
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 60_000,
    ...options,
  });
const work = await mkdtemp("/var/lib/latex-renderer/storage/ci-lifecycle-");
const workerUid = Number(run("id", ["-u", "latex-render-worker"]).trim()),
  group = Number(run("id", ["-g", "latex-render-worker"]).trim());
const suffix = randomUUID().replaceAll("-", ""),
  units = [],
  containers = [];
const workerEnv = {
  PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
  HOME: "/var/lib/latex-render-worker",
  XDG_RUNTIME_DIR: `/run/user/${workerUid}`,
  DOCKER_HOST: `unix:///run/user/${workerUid}/docker.sock`,
};
const docker = (args) =>
  run(
    "/usr/sbin/runuser",
    ["-u", "latex-render-worker", "--", "docker", ...args],
    { env: workerEnv },
  );
async function until(check) {
  for (let n = 0; n < 200; n++) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error("Lifecycle fixture readiness deadline exceeded");
}
async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
try {
  // Caller has exited, independent service still owns the common kernel lock.
  const unit = `latex-renderer-ci-lock-${suffix}.service`;
  units.push(unit);
  const lockPath = join(work, "mutation.lock"),
    ready = join(work, "lock-ready");
  const program = join(candidate, "deploy/ci/lifecycle-lock-fixture.mjs");
  run("/usr/bin/systemd-run", [
    "--quiet",
    `--unit=${unit}`,
    "--service-type=exec",
    "--property=KillMode=control-group",
    "/usr/local/bin/node",
    program,
    "hold",
    lockPath,
    ready,
  ]);
  await until(() => exists(ready));
  await assert.rejects(acquireMutationLockForPath(lockPath), {
    code: "MUTATION_LOCK_BUSY",
  });
  run("/usr/bin/systemctl", [
    "kill",
    "--kill-whom=main",
    "--signal=SIGKILL",
    unit,
  ]);
  run("/usr/bin/systemctl", ["stop", unit]);
  const free = await acquireMutationLockForPath(lockPath);
  await free.release();

  const unitSource = await readFile(
    join(candidate, "deploy/systemd/latex-renderer-worker.service"),
    "utf8",
  );
  const killMode = /^KillMode=(\w+)$/m.exec(unitSource)?.[1];
  assert.equal(killMode, "mixed");
  const image = /^RENDERER_IMAGE=(sha256:[a-f0-9]{64})$/m.exec(
    await readFile("/etc/latex-renderer/renderer.env", "utf8"),
  )?.[1];
  assert(image);
  await chown(work, workerUid, group);
  for (const forced of [false, true]) {
    const name = `latex-render-job_ci_${suffix}_${forced ? "forced" : "graceful"}-g1`;
    containers.push(name);
    const workerUnit = `latex-renderer-ci-worker-${forced ? "forced" : "graceful"}-${suffix}.service`;
    units.push(workerUnit);
    const receipt = join(work, forced ? "forced.json" : "graceful.json"),
      driver = join(work, forced ? "forced.mjs" : "graceful.mjs");
    const args = [
      "run",
      "--rm",
      "--init",
      "--name",
      name,
      "--network",
      "none",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--entrypoint",
      "/bin/sh",
      image,
      "-c",
      `sleep ${forced ? 30 : 3};exit 0`,
    ];
    await copyFile(
      join(candidate, "deploy/ci/lifecycle-docker-fixture.mjs"),
      driver,
    );
    await chmod(driver, 0o644);
    run("/usr/bin/systemd-run", [
      "--quiet",
      "--collect",
      `--unit=${workerUnit}`,
      "--service-type=exec",
      `--property=KillMode=${killMode}`,
      `--property=TimeoutStopSec=${forced ? "1s" : "15s"}`,
      "--property=User=latex-render-worker",
      "--property=Group=latex-renderer",
      `--setenv=HOME=${workerEnv.HOME}`,
      `--setenv=XDG_RUNTIME_DIR=${workerEnv.XDG_RUNTIME_DIR}`,
      `--setenv=DOCKER_HOST=${workerEnv.DOCKER_HOST}`,
      "/usr/local/bin/node",
      driver,
      "render",
      receipt,
      ...args,
    ]);
    await until(() =>
      Promise.resolve(
        docker(["ps", "-q", "--filter", `name=^${name}$`]).trim() !== "",
      ),
    );
    run("/usr/bin/systemctl", ["stop", workerUnit]);
    if (!forced)
      assert.deepEqual(JSON.parse(await readFile(receipt, "utf8")), {
        draining: true,
        completed: true,
      });
    else {
      assert.equal(await exists(receipt), false);
      // Daemon-managed containers outlive a killed CLI. Exercise the shipped
      // bounded cleanup before considering its lease/workspace reusable.
      run(
        "/usr/sbin/runuser",
        [
          "-u",
          "latex-render-worker",
          "--",
          "/usr/local/bin/node",
          driver,
          "cleanup",
          name,
        ],
        { env: workerEnv },
      );
    }
    assert.equal(
      docker(["ps", "-aq", "--filter", `name=^${name}$`]).trim(),
      "",
    );
  }
  console.log(
    JSON.stringify({
      event: "release.lifecycle_e2e.passed",
      independentServiceLock: true,
      killedHelperCleanup: true,
      gracefulDockerCompletion: true,
      forcedContainerCleanup: true,
    }),
  );
} finally {
  for (const unit of units) {
    try {
      run("/usr/bin/systemctl", ["stop", unit]);
    } catch {
      /* Already collected is safe. */
    }
    try {
      run("/usr/bin/systemctl", ["reset-failed", unit]);
    } catch {
      /* Transient unit already unloaded. */
    }
  }
  for (const name of containers) {
    try {
      docker(["rm", "-f", name]);
    } catch {
      /* Absent --rm container is safe. */
    }
  }
  await rm(work, { recursive: true, force: true });
}
