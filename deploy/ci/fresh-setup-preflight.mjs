// Installs prerequisites only on an empty GitHub-hosted runner. Never invoke
// this CI fixture as a production setup or recovery tool.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { configureDockerRepository } from "./docker-repository.mjs";
import {
  withoutUserEnvironmentDefaults,
  userEnvironmentKeys,
} from "./host-user-environment.mjs";
import {
  verifyCiReleaseArtifact,
  verifyCiValidationArtifact,
} from "../scripts/ci-release-artifact.mjs";
import {
  assembleBuildArtifacts,
  assertSealedControlTree,
} from "../scripts/release-assembly.mjs";

const script = fileURLToPath(import.meta.url),
  source = resolve(dirname(script), "../..");
if (
  process.getuid() !== 0 ||
  process.env.GITHUB_ACTIONS !== "true" ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
  !/^\d+$/.test(process.env.GITHUB_RUN_ID ?? "") ||
  !script.startsWith("/home/runner/work/") ||
  (process.argv.length !== 7 && process.argv.length !== 8)
)
  throw new Error(
    "Fresh setup fixture requires an empty disposable GitHub-hosted runner",
  );
for (const path of [
  "/etc/latex-renderer",
  "/opt/latex-renderer",
  "/var/lib/latex-renderer",
  "/etc/latex-renderer-ci-host.json",
]) {
  try {
    await access(path);
    throw new Error("Refusing fresh setup on a nonempty application host");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
const [artifact, tag, commit, digest, attestationBundle, sourceRef] =
  process.argv.slice(2);
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    stdio: "inherit",
    timeout: 600000,
    ...options,
  });
assert.equal(
  run("/usr/bin/git", ["-c", `safe.directory=${source}`, "rev-parse", "HEAD"], {
    cwd: source,
    encoding: "utf8",
    stdio: "pipe",
  }).trim(),
  commit,
);
await (sourceRef ? verifyCiValidationArtifact : verifyCiReleaseArtifact)({
  artifact,
  tag,
  commit,
  digest,
  attestationBundle,
  sourceRef,
});

// Clear only fixture-host PAM defaults; service accounts must not inherit the
// hosted runner's HOME/XDG paths when rootless systemd starts.
await writeFile(
  "/etc/environment",
  withoutUserEnvironmentDefaults(await readFile("/etc/environment", "utf8")),
);
for (const key of userEnvironmentKeys) delete process.env[key];
run("/bin/sh", [join(source, "deploy/scripts/install-host.sh")]);
await configureDockerRepository(run);
run("/usr/bin/apt-get", [
  "install",
  "--no-install-recommends",
  "-y",
  "nginx",
  "docker-ce-rootless-extras",
]);
run("/usr/bin/systemctl", ["stop", "nginx"]);
run("/bin/sh", [join(source, "deploy/scripts/configure-rootless-docker.sh")]);
const work = await mkdtemp("/opt/latex-renderer/update-staging/ci-fresh-");
const release = join(
  "/opt/latex-renderer/releases",
  `v${tag.slice(1)}-${commit.slice(0, 12)}`,
);
let dummy = false;
try {
  // Verification includes archive bounds/traversal checks before extraction.
  run("/usr/bin/tar", [
    "-xzf",
    artifact,
    "--no-same-owner",
    "--no-same-permissions",
    "-C",
    work,
  ]);
  await mkdir(release);
  await assembleBuildArtifacts({
    verifiedSource: join(work, `latex-renderer-server-${tag.slice(1)}`),
    buildSource: source,
    assembly: release,
    runCommand: run,
  });
  run("/usr/bin/chown", ["-R", "root:latex-renderer", release]);
  run("/usr/bin/chmod", ["-R", "u=rwX,g=rX,o=", release]);
  await assertSealedControlTree(release);
  await symlink(release, "/opt/latex-renderer/current");
  const { prepareServerApplication } = await import(
    pathToFileURL(join(release, "deploy/scripts/server-setup-prepare.mjs"))
  );
  await prepareServerApplication();
  await prepareServerApplication(); // Additive retry before any prompt/owner.
  const { prepareHttpActivation } = await import(
    pathToFileURL(join(release, "deploy/scripts/http-services.mjs"))
  );
  prepareHttpActivation(release, { values: {} });
  // The recovery edge must remain while the socket is inactive/unloaded.
  run("/usr/bin/systemctl", ["stop", "latex-renderer-status.socket"]);
  const before = run(
    "/usr/bin/systemctl",
    [
      "show",
      "--property=Before",
      "--value",
      "latex-renderer-authentication-recovery.service",
    ],
    { encoding: "utf8", stdio: "pipe" },
  );
  assert(before.split(/\s+/).includes("latex-renderer-status.socket"));
  assert.equal(
    run(
      "/usr/bin/systemctl",
      [
        "show",
        "--property=LoadState",
        "--value",
        "latex-renderer-admin-web.service",
      ],
      { encoding: "utf8", stdio: "pipe" },
    ).trim(),
    "not-found",
  );
  assert.equal(
    (await lstat("/etc/systemd/journald@latex-renderer-lan.conf")).mode & 0o777,
    0o644,
  );
  for (const name of [
    "lan-https.service",
    "lan-renew.service",
    "lan-renew.timer",
  ])
    assert.equal(
      run(
        "/usr/bin/systemctl",
        ["show", "--property=LoadState", "--value", `latex-renderer-${name}`],
        { encoding: "utf8", stdio: "pipe" },
      ).trim(),
      "loaded",
    );

  const { workerEngineCommand, withScopedContainerEngine } = await import(
    pathToFileURL(join(release, "deploy/scripts/on-demand-engine.mjs"))
  );
  // An immutable scratch image is enough for configuration preflight. This
  // fixture does not pull TeX Live or claim to exercise document rendering.
  const emptyTar = run(
    "/usr/bin/tar",
    ["-cf", "-", "--files-from", "/dev/null"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const image = workerEngineCommand("/usr/bin/docker", ["import", "-"], {
    run: (program, args, options) =>
      execFileSync(program, args, { ...options, input: emptyTar }),
  }).trim();
  assert.match(image, /^sha256:[a-f0-9]{64}$/);
  const { createInitialServerSetupHost } = await import(
    pathToFileURL(join(release, "deploy/scripts/server-setup-initial-host.mjs"))
  );
  const host = await createInitialServerSetupHost("initial"),
    review = globalThis.structuredClone(await host.current());
  review.runtime.rendererImage = image;
  await host.preview(review);
  // Own a dummy private address on this disposable runner only. No public DNS,
  // provider, credentials, certificate issuance or listening TLS is involved.
  run("/usr/sbin/ip", ["link", "add", "lr-ci-lan", "type", "dummy"]);
  dummy = true;
  run("/usr/sbin/ip", ["addr", "add", "192.168.253.1/24", "dev", "lr-ci-lan"]);
  run("/usr/sbin/ip", ["link", "set", "lr-ci-lan", "up"]);
  const origin = "https://192-168-253-1.lan.example.test";
  review.deployment.authentication.deployment.publicOrigin = origin;
  review.deployment.authentication.deployment.rendererPublicUrl = origin;
  review.deployment.ingress = {
    format: 1,
    mode: "standalone",
    publicOrigin: origin,
    accessScope: "lan",
    listenAddress: "192.168.253.1",
    allowedNetworks: ["192.168.253.0/24"],
    tlsProvider: "automatic",
    lanHttps: {
      format: 1,
      issuerId: "zerossl",
      termsAccepted: true,
      provider: {
        format: 1,
        provider: "akebi-local-acme",
        serverOrigin: "https://akebi.example.test",
        lanDomain: "lan.example.test",
        address: "192.168.253.1",
        keylessFallback: false,
      },
    },
  };
  await host.preview(review);
  // A normal compact idle shutdown must not make the next scoped inspection
  // depend on the old docker.sock inode, nor pin Docker for a Web session.
  const workerUid = Number(
    run("/usr/bin/id", ["-u", "latex-render-worker"], {
      encoding: "utf8",
      stdio: "pipe",
    }).trim(),
  );
  workerEngineCommand("/usr/bin/systemctl", [
    "--user",
    "stop",
    "docker.service",
    "docker.socket",
  ]);
  await assert.rejects(lstat(`/run/user/${workerUid}/docker.sock`), {
    code: "ENOENT",
  });
  await withScopedContainerEngine(
    async () => {
      assert((await lstat(`/run/user/${workerUid}/docker.sock`)).isSocket());
      assert.equal(
        workerEngineCommand("/usr/bin/docker", [
          "image",
          "inspect",
          "--format",
          "{{.Id}}",
          image,
        ]).trim(),
        image,
      );
    },
    { RENDERER_RUNTIME_MODE: "compact", WORKER_IDLE_ENABLED: "true" },
  );
  const { acquireEngineLock } = await import(
    pathToFileURL(join(release, "deploy/scripts/on-demand-engine.mjs"))
  );
  const idleLock = await acquireEngineLock({ exclusive: true });
  await idleLock.release();
  for (const path of [
    "/etc/latex-renderer/renderer.env",
    "/var/lib/latex-renderer/renderer.sqlite3",
  ])
    await assert.rejects(lstat(path), { code: "ENOENT" });
  console.log(
    JSON.stringify({
      event: "ci.fresh_setup_preflight",
      tag,
      commit,
      digest,
      custom: true,
      automaticLan: true,
      scopedEngine: true,
      configurationCommitted: false,
    }),
  );
} finally {
  if (dummy) run("/usr/sbin/ip", ["link", "delete", "lr-ci-lan"]);
  await rm(work, { recursive: true, force: true });
}
