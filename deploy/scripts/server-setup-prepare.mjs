import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { mkdir, lstat, open, realpath } from "node:fs/promises";
import { ServerInstallStore } from "./server-install-store.mjs";
import { controlledServerSetupRelease } from "./server-setup-initial-host.mjs";
import { acquireMutationLock } from "./mutation-lock.mjs";

const env = { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" };
const run = (path, args) =>
  execFileSync(path, args, {
    env,
    encoding: "utf8",
    timeout: 60_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
export const INITIAL_APPLICATION_UNITS = Object.freeze([
  "latex-renderer-authentication-recovery.service",
  "latex-renderer-api.service",
  "latex-renderer-admin-api.service",
  "latex-renderer-web.service",
  "latex-renderer-internal-api.service",
  "latex-renderer-worker.service",
  "latex-renderer-remote-mcp.service",
  "latex-renderer-standalone-gateway.service",
  "latex-renderer-ingress.service",
  "latex-renderer-image-manager.service",
  "latex-renderer-image-log-cleanup.service",
  "latex-renderer-image-log-cleanup.timer",
  "latex-renderer-image-operation-watchdog.service",
  "latex-renderer-image-operation-watchdog.timer",
  "latex-renderer-backup.service",
  "latex-renderer-backup.timer",
  "latex-renderer-audit-export.service",
  "latex-renderer-audit-export.timer",
  "latex-renderer-cleanup.service",
  "latex-renderer-cleanup.timer",
  "latex-renderer-update-manager.service",
  "latex-renderer-updater-recovery.service",
  "latex-renderer-updater-activate.service",
  "latex-renderer-update-refresh.service",
  "latex-renderer-update-refresh.timer",
  "latex-renderer-update-recovery-gc.service",
  "latex-renderer-update-recovery-gc.timer",
]);
async function absent(path) {
  const entry = await lstat(path).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (entry)
    throw new Error(
      "Initial application preparation refuses existing data/configuration",
    );
}
async function directory(path, uid, gid, mode) {
  let created = false;
  await mkdir(path, { mode })
    .then(() => {
      created = true;
    })
    .catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  const handle = await open(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    if (created) {
      await handle.chown(uid, gid);
      await handle.chmod(mode);
      await handle.sync();
    }
    const entry = await handle.stat();
    if (
      !entry.isDirectory() ||
      entry.uid !== uid ||
      entry.gid !== gid ||
      (entry.mode & 0o7777) !== mode ||
      (await realpath(path)) !== path
    )
      throw new Error("Existing application directory is not prepared safely");
  } finally {
    await handle.close();
  }
}
/** Only application files/dirs from the verified managed release. This never
 * invokes install-host/prepare-host, apt, useradd, systemctl enable, rootless
 * setup, firewall, Cloudflare, partition or quota tools. Missing prerequisites
 * fail BEFORE application preparation. Retrying is additive and hash-bound:
 * existing different files are never overwritten or automatically repaired.
 */
export async function prepareServerApplication() {
  if (process.geteuid?.() !== 0)
    throw new Error("Application preparation requires root");
  const release = await controlledServerSetupRelease();
  // A pending initial/ingress journal belongs to recovery, not fresh staging.
  const pending = await lstat(
    "/etc/latex-renderer/installation-transaction/journal.json",
  ).catch((error) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (pending) return;
  await absent("/etc/latex-renderer/renderer.env");
  await absent("/var/lib/latex-renderer/renderer.sqlite3");
  await absent("/etc/latex-renderer/authentication-transaction/journal.json");
  const gid = Number(
    run("/usr/bin/getent", ["group", "latex-renderer"]).split(":")[2],
  );
  const uid = (name) => Number(run("/usr/bin/id", ["-u", name]).trim());
  const renderer = uid("latex-renderer"),
    web = uid("latex-renderer-web"),
    worker = uid("latex-render-worker"),
    backup = uid("latex-renderer-backup"),
    updater = uid("latex-renderer-update");
  if (
    ![gid, renderer, web, worker, backup, updater].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    )
  )
    throw new Error("Prepared accounts required");
  if (
    !run("/usr/bin/id", ["-G", "latex-render-worker"])
      .trim()
      .split(/\s+/)
      .includes(String(gid))
  )
    throw new Error(
      "Prepared worker must belong to the application service group",
    );
  for (const executable of [
    "/usr/bin/age-keygen",
    "/usr/sbin/nginx",
    "/usr/bin/docker",
    "/usr/bin/flock",
    "/usr/sbin/runuser",
    "/usr/local/bin/node",
    "/usr/bin/setfacl",
    "/usr/sbin/visudo",
    "/usr/bin/systemd-tmpfiles",
    "/usr/bin/rsync",
    "/usr/bin/bsdtar",
    "/usr/local/bin/corepack",
    "/usr/local/bin/gh",
    "/usr/bin/ss",
  ])
    if (
      !(await lstat(executable)).isFile() &&
      !(await lstat(executable)).isSymbolicLink()
    )
      throw new Error("Prepared OS tooling required");
  if (process.versions.node.split(".")[0] !== "24")
    throw new Error("Prepared Node 24 required");
  run("/usr/local/bin/gh", ["attestation", "verify", "--help"]);
  const socket = await lstat(`/run/user/${worker}/docker.sock`);
  if (!socket.isSocket() || socket.uid !== worker)
    throw new Error("Prepared rootless Docker required");
  for (const unit of INITIAL_APPLICATION_UNITS) {
    const state = run("/usr/bin/systemctl", [
      "show",
      "--property=ActiveState",
      "--value",
      unit,
    ]).trim();
    if (
      !["inactive", "failed"].includes(state) &&
      !(
        unit === "latex-renderer-authentication-recovery.service" &&
        state === "active"
      )
    )
      throw new Error("Initial application services must be stopped");
  }
  for (const [path, owner, mode] of [
    ["/etc/latex-renderer", 0, 0o750],
    ["/etc/latex-renderer/secrets", 0, 0o750],
    ["/etc/latex-renderer/ticket-keys", 0, 0o750],
    ["/var/lib/latex-renderer", 0, 0o2770],
    ["/var/lib/latex-renderer/storage", renderer, 0o2770],
    ["/var/lib/latex-renderer/backups", backup, 0o750],
    ["/var/lib/latex-renderer/audit", backup, 0o750],
    ["/var/lib/latex-renderer/image-manager", 0, 0o750],
    ["/var/lib/latex-renderer/image-manager/operations", 0, 0o750],
    ["/var/lib/latex-renderer/image-manager/tmp", 0, 0o750],
    ["/var/lib/latex-renderer/image-manager/docker-config", worker, 0o700],
    ["/var/lib/latex-renderer/update-manager", updater, 0o750],
    ["/var/lib/latex-renderer/update-manager/operations", updater, 0o750],
    ["/var/lib/latex-renderer/update-manager/staging", updater, 0o700],
    ["/var/lib/latex-renderer/ingress", renderer, 0o750],
    ["/var/lib/latex-renderer/ingress/client", renderer, 0o750],
    ["/var/lib/latex-renderer/ingress/proxy", renderer, 0o750],
    ["/run/latex-renderer", 0, 0o770],
    ["/opt/latex-renderer/update-staging", 0, 0o711],
    ["/usr/local/libexec", 0, 0o755],
  ])
    await directory(
      path,
      owner,
      ["/opt/latex-renderer/update-staging", "/usr/local/libexec"].includes(
        path,
      )
        ? 0
        : gid,
      mode,
    );
  const lockHandle = await open(
    "/run/latex-renderer/mutation.lock",
    constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
    0o660,
  );
  try {
    const info = await lockHandle.stat();
    if (!info.isFile() || info.uid !== 0 || info.nlink !== 1 || info.size !== 0)
      throw new Error("Unsafe mutation lock");
    // This initial-only application lock has no secret content; it must be
    // usable by the already-prepared application service group.
    await lockHandle.chown(0, gid);
    await lockHandle.chmod(0o660);
  } finally {
    await lockHandle.close();
  }
  const lock = await acquireMutationLock();
  try {
    await absent("/etc/latex-renderer/renderer.env");
    await absent("/var/lib/latex-renderer/renderer.sqlite3");
    await directory(
      "/etc/latex-renderer/installation-transaction",
      0,
      0,
      0o700,
    );
    const files = Object.fromEntries(
      INITIAL_APPLICATION_UNITS.map((name, index) => [
        `unit${index}`,
        {
          path: `/etc/systemd/system/${name}`,
          gid: 0,
          mode: 0o644,
          maximum: 64 * 1024,
        },
      ]),
    );
    files.seccomp = {
      path: "/etc/latex-renderer/seccomp.json",
      gid,
      mode: 0o644,
      maximum: 64 * 1024,
    };
    files.tmpfiles = {
      path: "/etc/tmpfiles.d/latex-renderer-image-manager.conf",
      gid: 0,
      mode: 0o644,
      maximum: 64 * 1024,
    };
    const store = new ServerInstallStore(
      "/etc/latex-renderer/installation-transaction",
      files,
    );
    const entries = [];
    for (const [name, slot] of Object.entries(files)) {
      const source =
        name === "seccomp"
          ? `${release}/deploy/security/seccomp.json`
          : name === "tmpfiles"
            ? `${release}/deploy/tmpfiles.d/latex-renderer-image-manager.conf`
            : `${release}/deploy/systemd/${INITIAL_APPLICATION_UNITS[Number(name.slice(4))]}`;
      const info = await lstat(source);
      if (
        ![0, gid].includes(info.gid) ||
        ![0o640, 0o644].includes(info.mode & 0o7777)
      )
        throw new Error("Unsafe prepared release file permissions");
      const contents = await store.read({
        path: source,
        gid: info.gid,
        mode: info.mode & 0o7777,
        maximum: 64 * 1024,
      });
      if (contents === null) throw new Error("Prepared release file missing");
      const before = await store.read(slot);
      if (before !== null && before !== contents)
        throw new Error(
          "Existing application file differs; use managed upgrade, not fresh setup",
        );
      entries.push([slot, contents, before]);
    }
    for (const [slot, contents, before] of entries)
      if (before === null) await store.write(slot, contents);
    // Apply only this application's declared directories, never global clean.
    run("/usr/bin/systemd-tmpfiles", ["--create", files.tmpfiles.path]);
    // Source metadata and frozen-bootstrap equality are checked by the
    // existing independent Updater installer. No tool download/OS preparation.
    run("/usr/local/bin/node", [
      `${release}/deploy/scripts/install-updater.mjs`,
    ]);
    const helper = {
      path: "/usr/local/libexec/latex-renderer-update-helper",
      gid: 0,
      mode: 0o755,
      maximum: 64 * 1024,
    };
    const policy = {
      path: "/etc/sudoers.d/latex-renderer-update",
      gid: 0,
      mode: 0o440,
      maximum: 64 * 1024,
    };
    for (const [slot, source] of [
      [helper, `${release}/deploy/scripts/update-manager-helper-launcher.sh`],
      [policy, `${release}/deploy/sudoers.d/latex-renderer-update`],
    ]) {
      const info = await lstat(source);
      if (![0, gid].includes(info.gid) || info.mode & 0o022)
        throw new Error("Uncontrolled privileged helper source");
      const contents = await store.read({
        path: source,
        gid: info.gid,
        mode: info.mode & 0o7777,
        maximum: 64 * 1024,
      });
      const before = await store.read(slot);
      if (before !== null && before !== contents)
        throw new Error(
          "Existing privileged helper differs; use managed upgrade",
        );
      if (before === null) await store.write(slot, contents);
    }
    run("/usr/sbin/visudo", ["-cf", policy.path]);
    const backupEnv = {
      path: "/etc/latex-renderer/backup.env",
      gid,
      mode: 0o640,
      maximum: 4096,
    };
    const backupContents =
      "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3\nSTORAGE_ROOT=/var/lib/latex-renderer/storage\nBACKUP_DIRECTORY=/var/lib/latex-renderer/backups\n";
    const previousBackup = await store.read(backupEnv);
    if (previousBackup !== null && previousBackup !== backupContents)
      throw new Error("Existing backup settings differ");
    if (previousBackup === null) await store.write(backupEnv, backupContents);
    run("/usr/bin/systemctl", ["daemon-reload"]);
    // No credentials, DB, env or application consumers yet; boot recovery is
    // a no-journal no-op and can be activated without recursive locking.
    run("/usr/bin/systemctl", [
      "start",
      "latex-renderer-authentication-recovery.service",
    ]);
  } finally {
    await lock.release();
  }
}
