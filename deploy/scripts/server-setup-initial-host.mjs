import { spawn, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { lstat, mkdir, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname } from "node:path";
import { setTimeout, clearTimeout } from "node:timers";
import {
  validateServerSetupReview,
  validateServerInitialInput,
  validateServerIngressInput,
  serverSetupReviewEnvironment,
  SERVER_RUNTIME_LIMITS,
  renderServerIngressNginx,
  checkServerSetupOidc,
  importServerSetupReview,
} from "../../packages/server-setup-core/src/index.mjs";
import { ServerSetupSecrets } from "./server-setup-secrets.mjs";
import { assertServerSetupSockets } from "./server-setup-network.mjs";
import { ServerInstallStore } from "./server-install-store.mjs";
import {
  reviewInstallation,
  applyInstallation,
  recoverInstallation,
  installationReadyForConsumerStart,
  installationUnitActive,
} from "./server-install-transaction.mjs";
import { acquireMutationLock } from "./mutation-lock.mjs";
import {
  verifyIngressInterface,
  verifyProductionIngressTls,
  checkIngressHttpsHealth,
} from "./server-ingress.mjs";
import {
  checkAuthenticationHealth,
  requireServerSetupRecoveryOrdering,
} from "./configure-authentication.mjs";
import { requireAuthenticationOwner } from "./configure-authentication.mjs";
import {
  productionAuthenticationPlan,
  parseEnvironmentFile,
} from "../../packages/server-setup-core/src/index.mjs";

const databasePath = "/var/lib/latex-renderer/renderer.sqlite3";
const environmentPath = "/etc/latex-renderer/renderer.env";
const journalRoot = "/etc/latex-renderer/installation-transaction";
const secretRoot = "/etc/latex-renderer/secrets";
const runtimeUnits = [
  "latex-renderer-api.service",
  "latex-renderer-admin-api.service",
  "latex-renderer-remote-mcp.service",
  "latex-renderer-internal-api.service",
  "latex-renderer-worker.service",
  "latex-renderer-web.service",
  "latex-renderer-standalone-gateway.service",
];
const ingressUnit = "latex-renderer-ingress.service";
const maintenanceUnits = [
  "backup",
  "audit-export",
  "cleanup",
  "image-log-cleanup",
  "image-operation-watchdog",
  "update-refresh",
  "update-recovery-gc",
].map((name) => `latex-renderer-${name}.timer`);
const managers = [
  "latex-renderer-image-manager.service",
  "latex-renderer-update-manager.service",
];
const nginxPath = "/etc/latex-renderer/ingress-nginx.conf";
const childEnvironment = {
  PATH: "/usr/local/bin:/usr/bin:/bin",
  LANG: "C.UTF-8",
};
function command(path, args, timeout = 60_000) {
  return execFileSync(path, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 64 * 1024,
    env: childEnvironment,
    stdio: ["ignore", "pipe", "ignore"],
  });
}
const systemctl = (...args) =>
  command(
    "/usr/bin/systemctl",
    args,
    args[0] === "stop" && args[1] === "latex-renderer-worker.service"
      ? 16 * 60_000
      : 60_000,
  );
async function rootDirectory(path, gid, mode) {
  // Only application-owned fixed directories, never OS/account/Docker setup.
  let created = false;
  await mkdir(path, { mode })
    .then(() => {
      created = true;
    })
    .catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  if (created) {
    const handle = await open(
      path,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      await handle.chown(0, gid);
      await handle.chmod(mode);
    } finally {
      await handle.close();
    }
  }
  const info = await lstat(path);
  if (
    !info.isDirectory() ||
    info.uid !== 0 ||
    info.mode & 0o022 ||
    (await realpath(path)) !== path
  )
    throw new Error("Prepared application directory is unsafe");
  // Existing directories are never repaired. A newly created directory may
  // acquire the application's read-only group before any credential is placed.
  if (info.gid !== gid || (info.mode & 0o7777) !== mode)
    throw new Error(
      "Prepare application directory ownership and permissions first",
    );
}
export async function controlledServerSetupRelease() {
  const release = await realpath("/opt/latex-renderer/current");
  if (!/^\/opt\/latex-renderer\/releases\/[A-Za-z0-9._-]+$/.test(release))
    throw new Error("Verified prepared release required");
  for (const suffix of [
    "deploy/scripts/server-setup-owner.mjs",
    "packages/database/dist/index.js",
    "packages/auth/dist/bootstrap-owner.js",
  ]) {
    const path = `${release}/${suffix}`,
      file = await lstat(path);
    if (!file.isFile() || file.uid !== 0 || file.mode & 0o022)
      throw new Error("Root-controlled built application required");
    for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) {
      const info = await lstat(parent);
      if (
        !info.isDirectory() ||
        info.uid !== 0 ||
        info.mode & 0o022 ||
        (await realpath(parent)) !== parent
      )
        throw new Error("Release parents are not root controlled");
    }
  }
  return release;
}
function account(name) {
  const value = Number(command("/usr/bin/id", ["-u", name], 5000).trim());
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error("Prepared non-root account required");
  return value;
}
function ownerState(id) {
  let db;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    const marker = db.prepare("SELECT id FROM server_setup_bootstrap").all();
    if (marker.length !== 1 || marker[0].id !== id) return "foreign";
    // A crash can happen between the durable marker and schema migration.
    // Only this exact journal marker permits resuming that unowned database.
    if (
      !db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
        )
        .get()
    )
      return "none";
    const users = db.prepare("SELECT id FROM users WHERE role='owner'").all();
    if (!users.length) return "none";
    if (users.length !== 1) return "foreign";
    const audit = db
      .prepare(
        "SELECT target_id FROM audit_logs WHERE actor_id=? AND action='user.created' AND result='success'",
      )
      .all(`server-setup:${id}`);
    return audit.length === 1 && audit[0].target_id === users[0].id
      ? "ours"
      : "foreign";
  } finally {
    db?.close();
  }
}
async function runOwner(release, input) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      "/usr/sbin/runuser",
      [
        "-u",
        "latex-renderer",
        "--",
        "/usr/local/bin/node",
        `${release}/deploy/scripts/server-setup-owner.mjs`,
      ],
      { env: childEnvironment, stdio: ["pipe", "ignore", "ignore"] },
    );
    const timeout = setTimeout(() => child.kill("SIGTERM"), 60_000);
    child.on("error", reject);
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolve()
        : reject(new Error("Initial owner operation failed"));
    });
    child.stdin.end(JSON.stringify(input));
  });
}
/** Fresh application setup on prepared infrastructure. No OS installer, user
 * creation, Docker reconfiguration, downloads, Cloudflare API or shell input.
 */
export async function createInitialServerSetupHost(kind = "initial") {
  if (!["initial", "ingress", "auto"].includes(kind))
    throw new Error("Invalid setup scope");
  if (process.geteuid?.() !== 0) throw new Error("Initial setup requires root");
  const gid = Number(
    command("/usr/bin/getent", ["group", "latex-renderer"], 5000).split(":")[2],
  );
  if (!Number.isSafeInteger(gid) || gid <= 0)
    throw new Error("Renderer group is not prepared");
  const workerUid = account("latex-render-worker");
  account("latex-renderer");
  account("latex-renderer-update");
  account("latex-renderer-backup");
  const release = await controlledServerSetupRelease();
  await rootDirectory(journalRoot, 0, 0o700);
  const file = (path, mode, maximum, group = gid) => ({
    path,
    mode,
    maximum,
    gid: group,
  });
  const store = new ServerInstallStore(journalRoot, {
    environment: file(environmentPath, 0o640, 128 * 1024),
    certificate: file(`${secretRoot}/https-cert.pem`, 0o440, 512 * 1024),
    privateKey: file(`${secretRoot}/https-key.pem`, 0o440, 16 * 1024),
    nginx: file(nginxPath, 0o640, 64 * 1024),
    oidcSecret: file(`${secretRoot}/oidc-client-secret`, 0o440, 16 * 1024),
    updateEnv: file("/etc/latex-renderer/update-manager.env", 0o600, 4096, 0),
  });
  const existingJournal = await store.journal();
  if (kind === "auto") kind = existingJournal?.kind ?? "initial";
  if (existingJournal && existingJournal.kind !== kind)
    throw new Error("Recover using the matching setup scope");
  const keys = new ServerSetupSecrets(secretRoot, gid, 0, 0, true),
    tickets = new ServerSetupSecrets(
      "/etc/latex-renderer/ticket-keys",
      gid,
      0,
      0,
      true,
    );
  async function pendingOwner(id) {
    const info = await lstat(databasePath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info) return "none";
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.uid !== account("latex-renderer") ||
      info.mode & 0o007
    )
      throw new Error("Initial database is unsafe");
    return ownerState(id);
  }
  const adapter = {
    kind,
    async preflight(candidate) {
      const review = validateServerSetupReview(candidate);
      if (
        review.runtime.databasePath !== databasePath ||
        review.runtime.storageRoot !== "/var/lib/latex-renderer/storage" ||
        review.runtime.limits.jobTimeoutSeconds > 840 ||
        !review.deployment.ingress
      )
        throw new Error(
          "Prepared application paths, explicit HTTPS and bounded worker drain required",
        );
      const pending = await store.journal();
      const env = await store.read(store.slot("environment"));
      if (kind === "initial" && !pending && env !== null)
        throw new Error(
          "Use existing-host setup; never replace an initialized environment",
        );
      const db = await lstat(databasePath).catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (
        kind === "initial" &&
        db &&
        (!pending || (await pendingOwner(pending.id)) !== "none")
      )
        throw new Error("Recover the existing initial database first");
      if (kind === "ingress") {
        if (!env || !db)
          throw new Error("Existing configured database required");
        const current = importServerSetupReview(env);
        if (
          current.deployment.authentication.deployment.mode !== "standalone" ||
          current.deployment.ingress?.mode !== "standalone" ||
          current.deployment.ingress.tlsProvider !== "custom" ||
          review.deployment.ingress.mode !== "standalone" ||
          current.runtime.rendererImage !== review.runtime.rendererImage ||
          JSON.stringify(current.deployment.authentication.authentication) !==
            JSON.stringify(review.deployment.authentication.authentication)
        )
          throw new Error(
            "Ingress setup preserves existing auth, deployment mode and image",
          );
        const database = new DatabaseSync(databasePath, { readOnly: true });
        try {
          requireAuthenticationOwner(
            database,
            productionAuthenticationPlan(serverSetupReviewEnvironment(review)),
          );
        } finally {
          database.close();
        }
      }
      for (const unit of kind === "initial"
        ? [...runtimeUnits, ...managers, ...maintenanceUnits]
        : runtimeUnits) {
        if (
          systemctl("show", "--property=LoadState", "--value", unit).trim() !==
          "loaded"
        )
          throw new Error("Application units are not prepared");
        if (kind === "initial" && (await adapter.active(unit)))
          throw new Error("Fresh setup requires stopped application services");
        if (kind === "ingress" && !(await adapter.active(unit)))
          throw new Error("Ingress setup requires healthy existing services");
      }
      requireServerSetupRecoveryOrdering(
        systemctl(
          "show",
          "--property=Before",
          "--value",
          "latex-renderer-authentication-recovery.service",
        ),
        systemctl(
          "show",
          "--property=Requires",
          "--value",
          "latex-renderer-api.service",
        ),
        review.deployment.ingress.mode === "standalone"
          ? [...runtimeUnits, ingressUnit]
          : runtimeUnits,
      );
      // Prepare recovery before acquiring the mutation lock during apply; it
      // must not start recursively inside a service's Requires dependency.
      if (
        !(await adapter.active(
          "latex-renderer-authentication-recovery.service",
        )) &&
        !(
          kind === "initial" &&
          pending &&
          pending.phase === "pending" &&
          (await pendingOwner(pending.id)) === "none"
        )
      )
        throw new Error(
          "Activate the prepared recovery unit before starting setup",
        );
      const socket = await lstat(`/run/user/${workerUid}/docker.sock`);
      if (!socket.isSocket() || socket.uid !== workerUid)
        throw new Error("Rootless Docker is not prepared");
      const inspected = command("/usr/sbin/runuser", [
        "-u",
        "latex-render-worker",
        "--",
        "/usr/bin/docker",
        "--host",
        `unix:///run/user/${workerUid}/docker.sock`,
        "image",
        "inspect",
        "--format",
        "{{.Id}}",
        review.runtime.rendererImage,
      ]);
      if (!/^sha256:[a-f0-9]{64}\s*$/.test(inspected))
        throw new Error("Prepared immutable runtime image required");
      verifyIngressInterface(review.deployment.ingress);
      assertServerSetupSockets(
        command("/usr/bin/ss", ["-H", "-ltn"]),
        review.deployment.ingress,
        {
          fresh: kind === "initial",
          requireInternal: kind === "ingress",
          checkIngressPort: kind === "initial",
        },
      );
      if (review.deployment.ingress.mode === "standalone") {
        if (
          systemctl(
            "show",
            "--property=LoadState",
            "--value",
            ingressUnit,
          ).trim() !== "loaded" ||
          !systemctl("show", "--property=Requires", "--value", ingressUnit)
            .split(/\s+/)
            .includes("latex-renderer-authentication-recovery.service")
        )
          throw new Error(
            "Dedicated managed HTTPS service with recovery ordering required",
          );
        if (kind === "ingress") {
          if (!(await adapter.active(ingressUnit)))
            throw new Error("Existing HTTPS service must be active");
          command("/usr/sbin/nginx", ["-t", "-c", nginxPath]);
        }
      } else if (!(await adapter.active("cloudflared.service")))
        throw new Error("Existing Cloudflare connector required");
      await checkServerSetupOidc(review);
      await keys.directory();
      await tickets.directory();
      if (kind === "ingress") {
        await checkAuthenticationHealth(env, true);
        await checkIngressHttpsHealth(
          productionAuthenticationPlan(parseEnvironmentFile(env)).publicOrigin,
        );
      }
    },
    validateCredentials: (candidate, credentials) => {
      const checked = (
        kind === "initial"
          ? validateServerInitialInput
          : validateServerIngressInput
      )(candidate, credentials);
      if (kind === "initial") {
        if (!checked.deploymentUser)
          throw new Error("Choose an existing non-root deployment user");
        account(checked.deploymentUser);
        if (
          Number(
            command("/usr/bin/id", ["-g", checked.deploymentUser], 5000).trim(),
          ) <= 0
        )
          throw new Error("Deployment user group must be non-root");
      }
      return checked;
    },
    units: (candidate) => [
      ...(kind === "initial" ? managers : []),
      ...(candidate.deployment.ingress.mode === "standalone"
        ? [...runtimeUnits, ingressUnit]
        : runtimeUnits.filter((unit) => !unit.includes("standalone-gateway"))),
      ...(kind === "initial" ? maintenanceUnits : []),
    ],
    finalize: (units) => {
      // Persistent activation happens only AFTER health and durable commit.
      // A crash here keeps a committed journal and retries enable, not owner DB.
      if (kind === "initial") systemctl("enable", ...units);
    },
    active(unit) {
      return installationUnitActive(
        systemctl("show", "--property=LoadState", "--value", unit).trim(),
        systemctl("show", "--property=ActiveState", "--value", unit).trim(),
      );
    },
    stop: (unit) => systemctl("stop", unit),
    start: async (unit) => {
      if (
        kind === "initial" &&
        !(await adapter.active(
          "latex-renderer-authentication-recovery.service",
        ))
      )
        systemctl("start", "latex-renderer-authentication-recovery.service");
      return systemctl("start", unit);
    },
    ownerState: async (id) => {
      if (kind === "initial") return pendingOwner(id);
      const pending = await store.journal();
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        requireAuthenticationOwner(
          database,
          productionAuthenticationPlan(
            parseEnvironmentFile(pending.after.environment),
          ),
        );
        return "ours";
      } finally {
        database.close();
      }
    },
    async ensureSecrets() {
      if (kind === "ingress") return; // no rotation/repair during ingress change
      await keys.recover();
      await tickets.recover();
      for (const name of [
        "api-key-pepper",
        "auth-password-pepper",
        "image-manager-token",
        "update-manager-token",
      ])
        await keys.ensure(name);
      await tickets.ensure("v1.key");
      const identitySlot = file(
        `${secretRoot}/backup-age-identity`,
        0o400,
        16 * 1024,
        0,
      );
      const recipientSlot = file(
        `${secretRoot}/backup-age-recipient`,
        0o440,
        1024,
      );
      let identity = await store.read(identitySlot),
        recipient = await store.read(recipientSlot);
      if (!identity && recipient)
        throw new Error(
          "Backup identity is missing; never regenerate a referenced identity",
        );
      if (!identity) {
        identity = command("/usr/bin/age-keygen", [], 5000);
        if (!/^AGE-SECRET-KEY-1[A-Z0-9]+$/m.test(identity))
          throw new Error("Invalid generated backup identity");
        await store.write(identitySlot, identity);
      }
      const expectedRecipient = await new Promise((resolve, reject) => {
        const child = spawn("/usr/bin/age-keygen", ["-y"], {
          env: childEnvironment,
          stdio: ["pipe", "pipe", "ignore"],
        });
        let output = "";
        const timer = setTimeout(() => child.kill("SIGTERM"), 5000);
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          if (output.length > 1024) child.kill("SIGTERM");
        });
        child.on("error", reject);
        child.stdin.on("error", () => {});
        child.on("close", (code) => {
          clearTimeout(timer);
          code === 0 && /^age1[a-z0-9]+\n?$/.test(output)
            ? resolve(output.trim())
            : reject(new Error("Invalid backup recipient"));
        });
        child.stdin.end(identity);
      });
      if (recipient && recipient.trim() !== expectedRecipient)
        throw new Error("Existing backup key pair does not match");
      if (!recipient)
        await store.write(recipientSlot, `${expectedRecipient}\n`);
    },
    async createOwner(id, review, credentials) {
      if (kind === "ingress") return;
      const pepper = await keys.read("auth-password-pepper");
      try {
        await runOwner(release, {
          id,
          databasePath,
          review,
          owner: credentials.owner,
          pepper: pepper.toString("base64"),
        });
      } finally {
        pepper.fill(0);
      }
    },
    async files(review, credentials) {
      const env =
        kind === "ingress"
          ? parseEnvironmentFile(await store.read(store.slot("environment")))
          : new Map();
      for (const [key, value] of serverSetupReviewEnvironment(review))
        env.set(key, value);
      for (const [key, value] of Object.entries({
        CLIENT_DIST_ROOT: "/opt/latex-renderer/current/client-dist",
        API_KEY_PEPPER_ID: "v1",
        TICKET_SIGNING_KID: "v1",
        TICKET_SIGNING_KEY_DIR: "/etc/latex-renderer/ticket-keys",
        DOCKER_HOST: `unix:///run/user/${workerUid}/docker.sock`,
        RENDERER_CONTAINER_UID: "10000",
        RENDERER_CONTAINER_GID: "10000",
        RENDERER_SECCOMP_PROFILE: "/etc/latex-renderer/seccomp.json",
        ADMIN_API_WRITE_ENABLED: "true",
        ADMIN_API_ENABLED: "true",
        ADMIN_UI_ENABLED: "true",
      }))
        env.set(key, value);
      const result = {
        environment: [...env]
          .map(([key, value]) => `${key}=${value}\n`)
          .join(""),
        oidcSecret:
          kind === "ingress"
            ? await store.read(store.slot("oidcSecret"))
            : (credentials.oidcClientSecret ?? null),
        updateEnv:
          kind === "initial"
            ? `UPDATE_DEPLOY_USER=${credentials.deploymentUser}\n`
            : await store.read(store.slot("updateEnv")),
      };
      if (review.deployment.ingress.mode === "standalone")
        Object.assign(result, {
          certificate: credentials.tls.certificate,
          privateKey: credentials.tls.privateKey,
          nginx: `# Managed LaTeX Renderer HTTPS; independent of co-hosted nginx.service.\nuser latex-renderer;\nworker_processes 1;\npid /run/latex-renderer-ingress/nginx.pid;\nerror_log stderr warn;\nevents { worker_connections 256; }\nhttp {\naccess_log off;\ninclude /etc/nginx/mime.types;\nclient_body_temp_path /var/lib/latex-renderer/ingress/client;\nproxy_temp_path /var/lib/latex-renderer/ingress/proxy;\n${renderServerIngressNginx(review.deployment.ingress)}\n}\n`,
        });
      return result;
    },
    async validatePublished(files, beforeStart = false) {
      const review = importServerSetupReview(files.environment);
      if (kind === "initial")
        command("/bin/sh", [
          `${release}/deploy/scripts/configure-renderer-storage-acl.sh`,
          "/var/lib/latex-renderer/storage",
          "/etc/latex-renderer/renderer.env",
        ]);
      if (review.deployment.ingress.mode === "standalone") {
        verifyProductionIngressTls(review.deployment.ingress, gid);
        if (!beforeStart) {
          await rootDirectory("/run/latex-renderer-ingress", gid, 0o750);
          command("/usr/sbin/nginx", ["-t", "-c", nginxPath]);
        }
      }
    },
    async health(files) {
      const review = importServerSetupReview(files.environment);
      assertServerSetupSockets(
        command("/usr/bin/ss", ["-H", "-ltn"]),
        review.deployment.ingress,
        { requireInternal: true },
      );
      await checkAuthenticationHealth(files.environment, true);
      await checkIngressHttpsHealth(
        review.deployment.authentication.deployment.publicOrigin,
      );
    },
  };
  async function locked(operation) {
    const lock = await acquireMutationLock();
    try {
      return await operation();
    } finally {
      await lock.release();
    }
  }
  const defaults = validateServerSetupReview({
    format: 4,
    deployment: {
      format: 3,
      authentication: {
        format: 2,
        deployment: {
          mode: "standalone",
          publicOrigin: "https://renderer.example.test",
          rendererPublicUrl: "https://renderer.example.test",
        },
        authentication: {
          backend: "native",
          passwordEnabled: true,
          oidcEnabled: false,
        },
      },
      ingress: {
        format: 1,
        mode: "standalone",
        publicOrigin: "https://renderer.example.test",
        accessScope: "local",
        tlsProvider: "custom",
        listenAddress: "127.0.0.1",
      },
    },
    runtime: {
      databasePath,
      storageRoot: "/var/lib/latex-renderer/storage",
      rendererImage: `sha256:${"0".repeat(64)}`,
      limits: Object.fromEntries(
        Object.entries(SERVER_RUNTIME_LIMITS).map(([name, [, value]]) => [
          name,
          value,
        ]),
      ),
    },
  });
  return Object.freeze({
    scope:
      kind === "initial" ? "initial-prepared-host" : "ingress-prepared-host",
    current: async () => {
      const pending = await store.journal();
      return pending
        ? importServerSetupReview(pending.after.environment)
        : kind === "ingress"
          ? importServerSetupReview(await store.read(store.slot("environment")))
          : defaults;
    },
    preview: (review) =>
      locked(() => reviewInstallation(store, adapter, review)),
    apply: (envelope, credentials) =>
      locked(() => applyInstallation(store, adapter, envelope, credentials)),
    recover: async (beforeStart = false) => {
      try {
        return await locked(() =>
          recoverInstallation(store, adapter, beforeStart),
        );
      } catch (error) {
        // Reactivating a failed boot guard during initial apply must not acquire
        // its parent's live lock or start consumers recursively. Only verify
        // the exact owner-ready published state; keep journal until health.
        if (
          beforeStart &&
          error.code === "MUTATION_LOCK_BUSY" &&
          (await installationReadyForConsumerStart(store, adapter))
        ) {
          const journal = await store.journal();
          const review = importServerSetupReview(journal.after.environment);
          if (review.deployment.ingress.mode === "standalone")
            verifyProductionIngressTls(review.deployment.ingress, gid);
          for (const name of [
            "api-key-pepper",
            "auth-password-pepper",
            "image-manager-token",
            "update-manager-token",
          ])
            (await keys.read(name)).fill(0);
          (await tickets.read("v1.key")).fill(0);
          return { recovered: true, pendingHealth: true };
        }
        throw error;
      }
    },
  });
}
