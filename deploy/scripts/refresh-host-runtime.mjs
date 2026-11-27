import { execFileSync } from "node:child_process";
import { lstat, readdir, readlink, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { acquireInheritedMutationLock } from "./inherited-mutation-lock.mjs";
import { HTTP_SERVICE_PORTS } from "./http-services.mjs";
import {
  isHostRuntimeGeneration,
  recordHostRuntimeResult,
  replaceHostRuntimeLink,
  stageHostRuntime,
} from "./host-runtime-generation.mjs";
import { serverToolchainStatus } from "./server-toolchain-status.mjs";

const root = "/opt/latex-renderer/host-runtime";
const launchers = [
  ["/usr/local/bin/node", "bin/node"],
  ["/usr/local/bin/corepack", "corepack/dist/corepack.js"],
];
const nodeUnits = [
  "api",
  "admin-api",
  "admin-web",
  "internal-api",
  "image-manager",
  "remote-mcp",
  "standalone-gateway",
  "web",
  "worker",
  "update-manager",
  "public-mcp-agent",
  "public-mcp-gateway",
  "lan-https",
  "lan-authority",
].map((name) => `latex-renderer-${name}.service`);

function run(executable, args) {
  return execFileSync(executable, args, {
    encoding: "utf8",
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8" },
    timeout: 120_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

async function entry(path) {
  return lstat(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function pointer(name) {
  const path = join(root, name);
  const info = await entry(path);
  if (!info) return null;
  const target = info.uid === 0 && info.isSymbolicLink() && (await readlink(path));
  if (target !== "." && !isHostRuntimeGeneration(target))
    throw new Error(`Invalid host runtime pointer: ${name}`);
  const directory = await entry(join(root, target));
  if (!directory?.isDirectory() || directory.uid !== 0 || directory.mode & 0o022)
    throw new Error(`Invalid host runtime generation: ${name}`);
  return target;
}

async function managedLaunchers() {
  for (const [launcher, relative] of launchers) {
    const stat = await entry(launcher);
    if (!stat?.isSymbolicLink() || stat.uid !== 0) return false;
    const target = await readlink(launcher);
    if (target !== join(root, relative) && target !== join(root, "active", relative))
      return false;
  }
  return true;
}

function renderBusy() {
  const db = new DatabaseSync("/var/lib/latex-renderer/renderer.sqlite3", {
    readOnly: true,
    timeout: 2000,
  });
  try {
    return Boolean(db.prepare(`
      SELECT 1 FROM jobs
      WHERE status IN ('validating', 'running') OR lease_owner IS NOT NULL
      UNION ALL SELECT 1 FROM job_preview_requests WHERE status = 'running'
      UNION ALL SELECT 1 FROM pdf_inspections WHERE status = 'running'
      UNION ALL SELECT 1 FROM document_probes WHERE status = 'running'
      LIMIT 1
    `).get());
  } finally {
    db.close();
  }
}

function installedAptClient() {
  try {
    return run("/usr/bin/dpkg-query", ["-W", "-f=${db:Status-Status}", "n624-latex"]) === "installed";
  } catch (error) {
    if (error.status === 1) return false;
    throw error;
  }
}

async function activeNodeUnits() {
  const lines = run("/usr/bin/systemctl", [
    "show",
    "--property=Id",
    "--property=MainPID",
    ...nodeUnits,
  ]);
  const node = await realpath(launchers[0][0]);
  const units = [];
  for (const block of lines.split("\n\n")) {
    const name = /^Id=(.*)$/m.exec(block)?.[1];
    const pid = /^MainPID=([1-9][0-9]*)$/m.exec(block)?.[1];
    if (!name || !pid || !nodeUnits.includes(name)) continue;
    const executable = await readlink(`/proc/${pid}/exe`).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    if (executable === node) units.push(name);
  }
  return units;
}

async function restartAndCheck(units) {
  if (units.length === 0) return;
  run("/usr/bin/systemctl", ["restart", ...units]);
  await Promise.all(units.map(checkService));
}

async function checkService(unit) {
  const port = HTTP_SERVICE_PORTS[unit];
  if (port && unit !== "latex-renderer-standalone-gateway.service") {
    const deadline = Date.now() + 30_000;
    while (true) {
      const response = await globalThis.fetch(`http://127.0.0.1:${port}/health`, {
        redirect: "error",
        signal: globalThis.AbortSignal.timeout(2000),
      }).catch(() => null);
      await response?.body?.cancel();
      if (response?.ok) break;
      if (Date.now() >= deadline)
        throw new Error(`The service did not become healthy: ${unit}`);
      await delay(200);
    }
  }
  if (unit === "latex-renderer-update-manager.service")
    run("/bin/sh", ["/opt/latex-renderer/current/deploy/scripts/wait-update-manager-socket.sh"]);
  run("/usr/bin/systemctl", ["is-active", unit]);
  const pid = run("/usr/bin/systemctl", ["show", "--value", "--property=MainPID", unit]);
  if (!/^[1-9][0-9]*$/.test(pid) ||
      (await readlink(`/proc/${pid}/exe`)) !== (await realpath(launchers[0][0])))
    throw new Error(`The service did not start with the selected Node.js: ${unit}`);
}

async function cleanGenerations(keep) {
  const device = (await lstat(root)).dev;
  for (const name of await readdir(root)) {
    if (keep.includes(name)) continue;
    if (
      !isHostRuntimeGeneration(name) &&
      !/^\.runtime-(?:stage|link)-[A-Za-z0-9]{6}$/.test(name)
    ) continue;
    const path = join(root, name);
    const info = await lstat(path);
    if (!info.isDirectory() || info.uid !== 0 || info.dev !== device || info.mode & 0o022)
      throw new Error("Unexpected entry in the managed runtime directory");
    await rm(path, { recursive: true });
  }
}

async function refresh(bootRecovery) {
  const directory = await entry(root);
  if (!directory) return;
  if (!directory.isDirectory() || directory.uid !== 0 || directory.mode & 0o022)
    throw new Error("Untrusted managed runtime directory");
  if (!(await managedLaunchers())) return;
  const lock = await acquireInheritedMutationLock();
  try {
    const confirmed = await pointer("confirmed");
    const active = await pointer("active");
    if (active !== null && confirmed === null)
      throw new Error("Managed Node.js has no confirmed runtime");
    if (confirmed !== null && active !== confirmed) {
      const trialUnits = bootRecovery || active === null ? [] : await activeNodeUnits();
      await replaceHostRuntimeLink(join(root, "active"), confirmed);
      await restartAndCheck(trialUnits);
      await recordHostRuntimeResult(root, { status: "rolled-back", checkedAt: new Date().toISOString() });
      console.log("Restored the previous confirmed Node.js / Corepack generation.");
    }
    if (bootRecovery || !installedAptClient()) return;
    const { apt } = await serverToolchainStatus({
      nodePath: launchers[0][0],
      corepackPath: launchers[1][0],
      nodeVersion: run(launchers[0][0], ["--version"]).slice(1),
    });
    if (apt?.status !== "available" || renderBusy()) return;
    await cleanGenerations([confirmed]);
    const generation = await stageHostRuntime({
      root,
      library: "/usr/lib/n624-latex/runtime",
      nodeVersion: apt.nodeVersion,
      corepackVersion: apt.corepackVersion,
    });
    if (renderBusy() || !installedAptClient()) return;
    const units = await activeNodeUnits();
    const prior = confirmed ?? ".";
    if (confirmed === null) {
      await replaceHostRuntimeLink(join(root, "confirmed"), prior);
      await replaceHostRuntimeLink(join(root, "active"), prior);
    }
    // Interrupted migration may have retargeted just one launcher.
    for (const [launcher, relative] of launchers) {
      if ((await readlink(launcher)) === join(root, relative))
        await replaceHostRuntimeLink(launcher, join(root, "active", relative));
    }
    await replaceHostRuntimeLink(join(root, "active"), generation);
    try {
      await restartAndCheck(units);
      await replaceHostRuntimeLink(join(root, "confirmed"), generation);
    } catch (error) {
      await replaceHostRuntimeLink(join(root, "confirmed"), prior);
      await replaceHostRuntimeLink(join(root, "active"), prior);
      await restartAndCheck(units);
      await recordHostRuntimeResult(root, { status: "rolled-back", checkedAt: new Date().toISOString() });
      throw error;
    }
    await recordHostRuntimeResult(root, { status: "applied", checkedAt: new Date().toISOString() });
    await cleanGenerations([generation, prior]);
    console.log(`Active toolchain updated to Node.js ${apt.nodeVersion}, Corepack ${apt.corepackVersion}.`);
  } finally {
    await lock.release();
  }
}

if (process.getuid() !== 0 || process.argv.length > 3 ||
    (process.argv[2] !== undefined && process.argv[2] !== "--recover"))
  throw new Error("Host runtime refresh requires root and accepts only --recover");
try {
  await refresh(process.argv[2] === "--recover");
} catch (error) {
  if (error?.code === "MUTATION_LOCK_BUSY" && process.argv[2] === undefined)
    console.log("The toolchain update will retry after the active mutation finishes.");
  else throw error;
}
