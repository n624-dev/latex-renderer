import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyCiReleaseArtifact } from "../scripts/ci-release-artifact.mjs";
import { downloadPublishedRelease } from "../scripts/published-release.mjs";
import { acquireMutationLock } from "../scripts/mutation-lock.mjs";
import {
  brokenUpdaterSource,
  assertStartupRecovery,
} from "./updater-recovery-evidence.mjs";

if (
  process.getuid() !== 0 ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
  process.env.GITHUB_ACTIONS !== "true" ||
  !resolve(process.argv[1]).startsWith("/home/runner/work/")
)
  throw new Error("CI update entry is not a production installer");
const markerPath = "/etc/latex-renderer-ci-host.json",
  info = await lstat(markerPath);
if (!info.isFile() || info.uid !== 0 || info.mode & 0o077)
  throw new Error("Missing sealed CI host marker");
const marker = JSON.parse(await readFile(markerPath, "utf8"));
if (
  marker.runId !== process.env.GITHUB_RUN_ID ||
  marker.bootId !==
    (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
)
  throw new Error("CI host marker does not match this run/boot");
if (process.argv.length !== 7)
  throw new Error(
    "usage: update-e2e.mjs ARTIFACT TAG COMMIT sha256:DIGEST ATTESTATION",
  );
const [input, tag, commit, digest, proofInput] = process.argv.slice(2);
const root = await mkdtemp("/opt/latex-renderer/update-staging/ci-");
const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { stdio: "inherit", timeout: 5_400_000, ...options });
try {
  const artifact = join(root, "candidate.tar.gz");
  const attestationBundle = join(root, "candidate-attestation.jsonl");
  for (const [path, maximum] of [
    [input, 1024 ** 3],
    [proofInput, 8 * 1024 ** 2],
  ]) {
    const file = await lstat(path);
    if (!file.isFile() || file.size < 1 || file.size > maximum)
      throw new Error("Unbounded CI release input");
  }
  // CI inputs become private root-owned bytes before any verification or use.
  await copyFile(input, artifact);
  await copyFile(proofInput, attestationBundle);
  await verifyCiReleaseArtifact({
    artifact,
    tag,
    commit,
    digest,
    attestationBundle,
  });
  run("/usr/bin/tar", [
    "-xzf",
    artifact,
    "--no-same-owner",
    "--no-same-permissions",
    "-C",
    root,
  ]);
  const candidate = join(root, `latex-renderer-server-${tag.slice(1)}`);
  const helper = await import(
    pathToFileURL(join(candidate, "deploy/scripts/update-manager-helper.mjs"))
  );
  const deployUser = process.env.SUDO_USER;
  if (
    !deployUser ||
    deployUser === "root" ||
    !/^[a-z_][a-z0-9_-]*$/.test(deployUser)
  )
    throw new Error("Missing CI deployment user");
  const identity = {
    deployUser,
    uid: execFileSync("id", ["-u", deployUser], { encoding: "utf8" }).trim(),
    gid: execFileSync("id", ["-g", deployUser], { encoding: "utf8" }).trim(),
  };
  const deploy = async (source, release, initialInstall) => {
    const manifest = await helper.verifyExtractedRelease(release, source);
    const stage = await mkdtemp(
      "/opt/latex-renderer/update-staging/ci-deploy-",
    );
    let lock;
    try {
      const assembly = await helper.buildBootstrapRelease(
        stage,
        source,
        manifest.packageManager,
        identity,
      );
      if (!initialInstall) lock = await acquireMutationLock();
      await helper.deploySealedAssembly(
        assembly,
        stage,
        release,
        manifest,
        initialInstall,
      );
    } finally {
      if (lock) await lock.release();
      await rm(stage, { recursive: true, force: true });
    }
  };
  // Frozen historical baseline, not changed by the RC -> stable text promotion.
  const baselineTag = `v${[1, 3, 4].join(".")}-rc.5`;
  const oldStage = join(root, "baseline");
  await mkdir(oldStage);
  const baseline = await downloadPublishedRelease(baselineTag, oldStage);
  await deploy(baseline.source, { ...baseline, tag: baselineTag }, true);
  // Persist a real owner, DB record and storage data before candidate update.
  const password = "/etc/latex-renderer/ci/password";
  await writeFile(password, randomBytes(32).toString("base64url"), {
    mode: 0o600,
  });
  const adminEnv = {
    ...process.env,
    DATABASE_PATH: "/var/lib/latex-renderer/renderer.sqlite3",
    API_KEY_PEPPER_FILE: "/etc/latex-renderer/secrets/api-key-pepper",
    AUTH_PASSWORD_PEPPER_FILE:
      "/etc/latex-renderer/secrets/auth-password-pepper",
  };
  run(
    "/usr/local/bin/node",
    [
      "/opt/latex-renderer/current/apps/admin-local/dist/index.js",
      "bootstrap",
      "--auth-mode",
      "password",
      "--display-name",
      "Release E2E owner",
      "--login-name",
      "release-e2e",
      "--password-file",
      password,
    ],
    { env: adminEnv, stdio: "pipe" },
  );
  const data = randomBytes(32).toString("hex"),
    sentinel = "/var/lib/latex-renderer/storage/update-e2e-sentinel";
  await writeFile(sentinel, data, { mode: 0o640 });
  run("/usr/bin/chown", ["latex-renderer:latex-renderer", sentinel]);
  run("/bin/sh", [
    "/opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh",
  ]);
  // This disposable host drives activation synchronously. Prevent the signed
  // driver's delayed systemd job from racing our positive/negative fixtures.
  // The bootstrap itself remains unchanged and still takes the normal lock.
  const activationDropIn =
    "/run/systemd/system/latex-renderer-updater-activate.service.d";
  await mkdir(activationDropIn, { recursive: true });
  await writeFile(
    join(activationDropIn, "90-ci-explicit-activation.conf"),
    "[Unit]\nConditionPathExists=!/etc/latex-renderer-ci-host.json\n",
    { mode: 0o644 },
  );
  run("/usr/bin/systemctl", ["daemon-reload"]);
  await deploy(candidate, { version: tag.slice(1), tag, commit }, false);
  run("/usr/local/bin/node", [
    "/opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs",
    "activate",
  ]);
  const { UpdaterSlots, updaterEnvelope } = await import(
    pathToFileURL(join(candidate, "deploy/scripts/updater-slots.mjs"))
  );
  const slots = new UpdaterSlots("/opt/latex-renderer/updater", 0);
  const active = await slots.state(),
    installed = await slots.verify(active.current);
  if (
    active.pending ||
    installed.envelope.version !== tag.slice(1) ||
    !active.previous
  )
    throw new Error("Independent Updater cutover did not finish");
  if ((await readFile(sentinel, "utf8")) !== data)
    throw new Error("Storage was not preserved");
  const owners = execFileSync(
    "/usr/bin/sqlite3",
    [
      "/var/lib/latex-renderer/renderer.sqlite3",
      "SELECT count(*) FROM users WHERE role='owner' AND status='active';",
    ],
    { encoding: "utf8" },
  ).trim();
  if (owners !== "1") throw new Error("Owner did not survive migration");
  run("/bin/sh", [
    "/opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh",
  ]);
  // Negative fixture: a different local test slot, NOT a mutation of the signed
  // candidate or a published artifact. The production bootstrap must restore
  // the prior controller when this intentionally broken entry cannot start.
  const broken = join(root, "broken-updater-fixture");
  const startupNonce = randomBytes(24).toString("hex");
  const startupMarker = `/var/lib/latex-renderer/update-manager/ci-startup-${startupNonce}.json`;
  run("/usr/bin/rsync", ["-a", `${installed.root}/`, `${broken}/`]);
  await writeFile(
    join(broken, "deploy/updater-files.json"),
    JSON.stringify(Object.keys(installed.envelope.files)),
  );
  await writeFile(
    join(broken, "deploy/scripts/update-manager.mjs"),
    brokenUpdaterSource(startupMarker, startupNonce),
  );
  const brokenId = await slots.stage(
    broken,
    await updaterEnvelope(broken, {
      version: tag.slice(1),
      commit,
    }),
  );
  await slots.nominate(brokenId);
  let failure = null;
  try {
    run(
      "/usr/local/bin/node",
      [
        "/opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs",
        "activate",
      ],
      { stdio: "pipe" },
    );
  } catch (error) {
    failure = error;
  }
  let startupEvidence = null;
  try {
    startupEvidence = JSON.parse(await readFile(startupMarker, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  } finally {
    await rm(startupMarker, { force: true });
  }
  assertStartupRecovery({
    failure,
    marker: startupEvidence,
    nonce: startupNonce,
    brokenRoot: join(slots.root, "slots", brokenId),
    state: await slots.state(),
    before: active,
  });
  run("/bin/sh", [
    "/opt/latex-renderer/current/deploy/scripts/wait-update-manager-socket.sh",
  ]);
  // Simulate a stopped process after journal/current switch, before health commit.
  run("/usr/bin/systemctl", ["stop", "latex-renderer-update-manager.service"]);
  await slots.nominate(active.previous);
  await slots.begin();
  run("/usr/local/bin/node", [
    "/opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs",
    "recover",
  ]);
  run("/usr/bin/systemctl", ["start", "latex-renderer-update-manager.service"]);
  if ((await slots.state()).current !== active.current)
    throw new Error("Interrupted activation was not recovered");
  run("/bin/sh", [
    "/opt/latex-renderer/current/deploy/scripts/wait-update-manager-socket.sh",
  ]);
  if ((await readFile(sentinel, "utf8")) !== data)
    throw new Error("Recovery touched application data");
  console.log(
    JSON.stringify({
      event: "release.update_e2e.passed",
      baselineTag,
      tag,
      commit,
      digest,
      standalone: true,
      ownerPreserved: true,
      storagePreserved: true,
      pdfPng: true,
      updaterRecovery: true,
      updaterStartupFailureRecovery: true,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
