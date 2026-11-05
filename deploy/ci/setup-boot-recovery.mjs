// Boot-equivalent dependency transactions on the fresh disposable CI host.
// Consumers are inert. The installed recovery entrypoint and sandbox are real.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function verifySetupBootRecovery(release, work, image) {
  assert.equal(process.getuid(), 0);
  assert.equal(process.env.GITHUB_ACTIONS, "true");
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted");
  assert.match(process.env.GITHUB_RUN_ID ?? "", /^\d+$/);
  assert.match(release, /^\/opt\/latex-renderer\/releases\/[A-Za-z0-9._-]+$/);
  const load = (name) =>
    import(pathToFileURL(join(release, "deploy/scripts", name)));
  const run = (program, args, options = {}) =>
    execFileSync(program, args, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120000,
      ...options,
    });
  const systemctl = (...args) => run("/usr/bin/systemctl", args).trim();
  const { createInitialServerSetupHost, serverSetupEnvironmentFile } =
    await load("server-setup-initial-host.mjs");
  const { ServerInstallStore } = await load("server-install-store.mjs");
  const { ServerSetupSecrets } = await load("server-setup-secrets.mjs");
  const { renderServerIngressNginx } = await import(
    pathToFileURL(join(release, "packages/server-setup-core/src/index.mjs"))
  );
  const gid = Number(run("/usr/bin/id", ["-g", "latex-renderer"]).trim());
  const workerUid = Number(
    run("/usr/bin/id", ["-u", "latex-render-worker"]).trim(),
  );
  const database = "/var/lib/latex-renderer/renderer.sqlite3";
  await assert.rejects(lstat(database), { code: "ENOENT" });
  const host = await createInitialServerSetupHost();
  const review = globalThis.structuredClone(await host.current());
  review.runtime.rendererImage = image;
  review.deployment.authentication.deployment.publicOrigin =
    "https://localhost";
  review.deployment.authentication.deployment.rendererPublicUrl =
    "https://localhost";
  review.deployment.ingress.publicOrigin = "https://localhost";
  const secretRoot = "/etc/latex-renderer/secrets";
  const keys = new ServerSetupSecrets(secretRoot, gid, 0, 0, true);
  for (const key of [
    "api-key-pepper",
    "auth-password-pepper",
    "image-manager-token",
    "update-manager-token",
  ])
    await keys.ensure(key);
  const tickets = new ServerSetupSecrets(
    "/etc/latex-renderer/ticket-keys",
    gid,
    0,
    0,
    true,
  );
  await tickets.ensure("v1.key");
  run("/usr/bin/openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "basicConstraints=critical,CA:FALSE",
    "-addext",
    "subjectAltName=DNS:localhost",
    "-addext",
    "extendedKeyUsage=serverAuth",
    "-out",
    join(work, "cert.pem"),
    "-keyout",
    join(work, "key.pem"),
  ]);
  const slot = (path, mode, maximum, group = gid) => ({
    path,
    mode,
    maximum,
    gid: group,
  });
  const store = new ServerInstallStore(
    "/etc/latex-renderer/installation-transaction",
    {
      environment: slot("/etc/latex-renderer/renderer.env", 0o640, 128 * 1024),
      certificate: slot(`${secretRoot}/https-cert.pem`, 0o440, 512 * 1024),
      privateKey: slot(`${secretRoot}/https-key.pem`, 0o440, 16 * 1024),
      nginx: slot("/etc/latex-renderer/ingress-nginx.conf", 0o640, 64 * 1024),
      updateEnv: slot("/etc/latex-renderer/update-manager.env", 0o600, 4096, 0),
    },
  );
  const after = {
    environment: serverSetupEnvironmentFile("initial", "", review, workerUid),
    certificate: await readFile(join(work, "cert.pem"), "utf8"),
    privateKey: await readFile(join(work, "key.pem"), "utf8"),
    nginx: `events {}\nhttp {\n${renderServerIngressNginx(review.deployment.ingress)}\n}\n`,
    updateEnv: `UPDATE_DEPLOY_USER=${process.env.SUDO_USER}\n`,
  };
  const units = [
    "api",
    "admin-api",
    "remote-mcp",
    "internal-api",
    "worker",
    "web",
    "standalone-gateway",
    "ingress",
    "image-manager",
    "update-manager",
  ].map((name) => `latex-renderer-${name}.service`);
  units.push("latex-renderer-status.socket");
  const timer = "latex-renderer-image-log-cleanup.timer";
  units.push(timer);
  const journal = {
    format: 1,
    id: randomBytes(24).toString("hex"),
    kind: "initial",
    phase: "owner-ready",
    units,
    before: await store.snapshotFiles(after),
    after,
  };
  await store.saveJournal(journal);
  await store.replace(after);
  const pepper = await keys.read("auth-password-pepper");
  try {
    run(
      "/usr/sbin/runuser",
      [
        "-u",
        "latex-renderer",
        "--",
        "/usr/local/bin/node",
        join(release, "deploy/scripts/server-setup-owner.mjs"),
      ],
      {
        input: JSON.stringify({
          databasePath: database,
          id: journal.id,
          review,
          pepper: pepper.toString("base64"),
          owner: {
            displayName: "CI recovery owner",
            loginName: "ci-recovery-owner",
            password: randomBytes(32).toString("hex"),
          },
        }),
      },
    );
  } finally {
    pepper.fill(0);
  }
  const fingerprints = async () =>
    Promise.all(
      [
        database,
        `${secretRoot}/auth-password-pepper`,
        `${secretRoot}/api-key-pepper`,
        "/etc/latex-renderer/ticket-keys/v1.key",
      ].map(async (path) =>
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex"),
      ),
    );
  const before = await fingerprints();
  const consumers = ["admin-api", "image-manager", "update-manager"];
  const dropIns = consumers.map(
    (name) =>
      `/run/systemd/system/latex-renderer-${name}.service.d/90-ci-inert.conf`,
  );
  const recovery = "latex-renderer-authentication-recovery.service";
  try {
    for (const path of dropIns) {
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(
        path,
        "[Service]\nType=oneshot\nRemainAfterExit=yes\nRestart=no\nExecStart=\nExecStart=/usr/bin/true\nExecStartPre=\nExecStartPost=\nExecStop=\nExecStopPost=\n",
        { mode: 0o644 },
      );
    }
    systemctl("daemon-reload");
    systemctl("stop", ...units, recovery);
    // Simulate /run loss after confirming all consumers and recovery stopped.
    await rm("/run/latex-renderer/mutation.lock", { force: true });
    systemctl("start", "latex-renderer-admin-api.service");
    assert.equal(
      systemctl("show", "--property=Result", "--value", recovery),
      "success",
    );
    assert.equal(
      systemctl("is-active", "latex-renderer-admin-api.service"),
      "active",
    );
    assert.equal(
      systemctl("show", "--property=ActiveState", "--value", timer),
      "inactive",
    );
    assert.equal((await store.journal()).phase, "owner-ready");
    assert.deepEqual(await fingerprints(), before);
    assert((await lstat("/run/latex-renderer/mutation.lock")).isFile());
    assert(
      (await lstat("/etc/systemd/system/latex-renderer-api.service")).isFile(),
    );
    systemctl("stop", ...units, recovery);
    // A durable commit enables maintenance, without starting consumers from
    // inside their own recovery dependency.
    await store.saveJournal({ ...journal, phase: "committed" });
    systemctl("start", recovery);
    assert.equal(await store.journal(), null);
    assert.equal(systemctl("is-enabled", timer), "enabled");
    systemctl("stop", recovery);
    const changed = globalThis.structuredClone(review);
    changed.deployment.ingress.listenAddress = "127.0.0.2";
    const pending = {
      ...after,
      environment: serverSetupEnvironmentFile(
        "ingress",
        after.environment,
        changed,
        workerUid,
      ),
      nginx: `events {}\nhttp {\n${renderServerIngressNginx(changed.deployment.ingress)}\n}\n`,
    };
    await store.saveJournal({
      ...journal,
      id: randomBytes(24).toString("hex"),
      kind: "ingress",
      phase: "pending",
      before: after,
      after: pending,
    });
    await store.replace(pending);
    systemctl("start", recovery);
    assert.equal(await store.journal(), null);
    assert.deepEqual(await store.snapshotFiles(after), after);
    assert.deepEqual(await fingerprints(), before);
    console.log(
      JSON.stringify({
        event: "ci.setup_boot_recovery.passed",
        initialOwnerReady: true,
        deferredTimer: true,
        committedTimerEnabled: true,
        ingressRollback: true,
        actualSandbox: true,
        mutationLockRecreated: true,
        ownerAndKeysPreserved: true,
      }),
    );
  } finally {
    systemctl("stop", ...units, recovery);
    for (const path of dropIns) await rm(path, { force: true });
    systemctl("daemon-reload");
  }
}
