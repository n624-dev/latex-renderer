import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { httpServiceStatus } from "../scripts/http-services.mjs";
import { withHostRecovery } from "../scripts/update-recovery-host.mjs";
import {
  acquireInheritedMutationLock,
  acquireInheritedMutationLockForPath,
  withInheritedMutationLock,
} from "../scripts/inherited-mutation-lock.mjs";

const root = "/opt/latex-renderer/current";
const run = (program, args, options = {}) =>
  execFileSync(program, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 600000,
    ...options,
  });
async function requireCiHost() {
  assert.equal(process.getuid(), 0);
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  const path = "/etc/latex-renderer-ci-host.json";
  const info = await lstat(path);
  assert(info.isFile() && info.uid === 0 && !(info.mode & 0o077));
  const marker = JSON.parse(await readFile(path, "utf8"));
  assert.equal(marker.runId, process.env.GITHUB_RUN_ID);
  assert.equal(
    marker.bootId,
    (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim(),
  );
}
async function failDeployment() {
  await requireCiHost();
  const helper = await acquireInheritedMutationLockForPath(
    "/opt/latex-renderer/update-staging/update-helper.lock",
  );
  let lock;
  try {
    lock = await acquireInheritedMutationLock();
    await withInheritedMutationLock(lock, () =>
      withHostRecovery(async () => {
        const driver = await readFile(
          `${root}/deploy/scripts/deploy-production-release.sh`,
          "utf8",
        );
        const start = driver.indexOf("restore_services_after_failure() {");
        const end = driver.indexOf("\ncleanup() {", start);
        assert(start >= 0 && end > start);
        run("/bin/sh", [
          "-eu",
          "-c",
          `
        source_root=${root}
        parent_mutation_lock=application-update
        web_service=latex-renderer-web.service
        deployment_mode=standalone
        http_control() { /usr/local/bin/node "$source_root/deploy/scripts/http-services.mjs" "$@"; }
        restore_lan_services() { return 0; }
        ${driver.slice(start, end)}
        restore_services_after_failure
        [ "$recovery_failed" = false ]
      `,
        ]);
        throw new Error("CI_EXPECTED_DEPLOYMENT_FAILURE");
      }),
    );
    throw new Error("Expected the deployment to fail");
  } catch (error) {
    assert.match(
      error.message,
      /RECOVERY_REVIEW_REQUIRED.*CI_EXPECTED_DEPLOYMENT_FAILURE/,
    );
    process.exitCode = 77;
  } finally {
    await lock?.release();
    await helper.release();
  }
}

export async function verifyGatewayFailureRecovery() {
  await requireCiHost();
  const environment = await readFile(
    "/etc/latex-renderer/renderer.env",
    "utf8",
  );
  assert.match(environment, /^RENDERER_RUNTIME_MODE=compact$/m);
  let status = 0;
  try {
    run(process.execPath, [fileURLToPath(import.meta.url), "--fail"], {
      stdio: "inherit",
    });
  } catch (error) {
    status = error.status;
  }
  assert.equal(
    status,
    77,
    "The intentional failure must finish its real recovery cleanup",
  );
  const journalPath = "/var/lib/latex-renderer-update-recovery/operation.json";
  const pending = JSON.parse(await readFile(journalPath, "utf8"));
  assert.match(pending.pointId, /^rp-[0-9]{13}-[a-f0-9]{12}$/);
  const systemctl = (...args) => run("/usr/bin/systemctl", args);
  const gateway = "latex-renderer-standalone-gateway.service";
  assert(httpServiceStatus(gateway, { run: systemctl }).operational);
  assert.equal(
    systemctl(
      "show",
      "--property=ActiveState",
      "--value",
      "latex-renderer-standalone-gateway.socket",
    ).trim(),
    "active",
  );
  run(process.execPath, [
    `${root}/deploy/scripts/update-recovery-host.mjs`,
    "acknowledge",
    pending.pointId,
  ]);
  await assert.rejects(readFile(journalPath), { code: "ENOENT" });
  assert(httpServiceStatus(gateway, { run: systemctl }).operational);
  console.log(
    JSON.stringify({
      event: "ci.gateway_failure_recovery.passed",
      actualFailureCleanup: true,
      protectedPointAcknowledged: true,
      compactListenerRestored: true,
    }),
  );
}

if (
  process.argv[1] === fileURLToPath(import.meta.url) &&
  process.argv[2] === "--fail"
)
  await failDeployment();
