import { execFileSync } from "node:child_process";
import { request } from "node:http";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  statfs,
} from "node:fs/promises";
import { join } from "node:path";
import { UpdaterSlots, recoverPendingUpdater } from "./updater-slots.mjs";
import { downloadPublishedRelease } from "./published-release.mjs";
import { acquireMutationLock } from "./mutation-lock.mjs";

if (process.getuid() !== 0) throw new Error("Updater bootstrap requires root");
const slots = new UpdaterSlots("/opt/latex-renderer/updater", 0);
const [verb, version] = process.argv.slice(2);
if (
  !(
    ["activate", "recover", "status"].includes(verb) &&
    process.argv.length === 3
  ) &&
  !(verb === "upgrade" && process.argv.length === 4)
)
  throw new Error(
    "usage: updater-bootstrap activate|recover|status|upgrade VERSION",
  );
const systemctl = (...args) =>
  execFileSync("/usr/bin/systemctl", args, {
    stdio: "inherit",
    timeout: 120_000,
  });
const backup = join(slots.root, "controller-state-backup.json");
async function cleanupDownloads() {
  const root = "/opt/latex-renderer/update-staging";
  const info = await lstat(root);
  if (
    !info.isDirectory() ||
    info.uid !== 0 ||
    info.mode & 0o022 ||
    (await realpath(root)) !== root
  )
    throw new Error("Unsafe bootstrap download root");
  const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
    .split("\n")
    .map((line) =>
      line
        .split(" ")[4]
        ?.replace(/\\([0-7]{3})/g, (_, octal) =>
          String.fromCharCode(parseInt(octal, 8)),
        ),
    )
    .filter(Boolean);
  const visit = async (path) => {
    const entry = await lstat(path);
    if (
      entry.uid !== 0 ||
      entry.dev !== info.dev ||
      entry.isSymbolicLink() ||
      mounts.includes(path)
    )
      throw new Error("Unsafe bootstrap download cleanup target");
    if (entry.isDirectory())
      for (const name of await readdir(path)) await visit(join(path, name));
    else if (!entry.isFile())
      throw new Error("Unexpected bootstrap download entry");
  };
  for (const name of await readdir(root))
    if (/^updater-[A-Za-z0-9]{6}$/.test(name)) {
      const path = join(root, name);
      await visit(path);
      await rm(path, { recursive: true });
    }
}
// Read/write the controller's mutable state AS its owner, never as root through
// an attacker-replaceable path. No application database is restored here.
const stateProgram = `
  const fs=require('node:fs'); const p='/var/lib/latex-renderer/update-manager/state.json';
  if(process.argv[1]==='read') {
    try {const s=fs.lstatSync(p);if(!s.isFile()||s.size>1048576)throw Error('bad state');process.stdout.write(fs.readFileSync(p));}
    catch(e){if(e.code!=='ENOENT')throw e;process.stdout.write('null');}
  } else {const data=fs.readFileSync(0);JSON.parse(data);if(data.toString()==='null')fs.rmSync(p,{force:true});
    else {const t=p+'.bootstrap-'+process.pid;const f=fs.openSync(t,'wx',0o640);fs.writeFileSync(f,data);fs.fsyncSync(f);fs.closeSync(f);fs.renameSync(t,p);}
    const d=fs.openSync('/var/lib/latex-renderer/update-manager','r');fs.fsyncSync(d);fs.closeSync(d);}
`;
const controllerState = (mode, input) =>
  execFileSync(
    "/usr/sbin/runuser",
    [
      "-u",
      "latex-renderer-update",
      "--",
      "/usr/local/bin/node",
      "-e",
      stateProgram,
      mode,
    ],
    {
      input,
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    },
  );
async function restore() {
  const state = await slots.state();
  if (!state.pending) return;
  const info = await lstat(backup);
  if (
    !info.isFile() ||
    info.uid !== 0 ||
    info.mode & 0o077 ||
    info.size > 1024 * 1024
  )
    throw new Error("Unsafe controller recovery state");
  controllerState("write", await readFile(backup));
  await slots.recover();
}
async function healthy() {
  const pid = execFileSync(
    "/usr/bin/systemctl",
    [
      "show",
      "latex-renderer-update-manager.service",
      "--property=MainPID",
      "--value",
    ],
    { encoding: "utf8" },
  ).trim();
  if (!/^[1-9]\d*$/.test(pid)) throw new Error("Updater has no main process");
  const state = await slots.state();
  if (
    (await realpath(`/proc/${pid}/cwd`)) !==
    join(slots.root, "slots", state.current)
  )
    throw new Error("Updater process is not running from the selected slot");
  const token = (
    await readFile("/etc/latex-renderer/secrets/update-manager-token", "utf8")
  ).trim();
  await new Promise((resolve, reject) => {
    const req = request(
      {
        socketPath: "/run/latex-renderer/update-manager.sock",
        path: "/v1/state",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          res.statusCode === 200
            ? resolve()
            : reject(new Error("Updater health failed")),
        );
      },
    );
    req.setTimeout(2000, () =>
      req.destroy(new Error("Updater health timeout")),
    );
    req.on("error", reject);
    req.end();
  });
}
async function activate() {
  await systemctl("stop", "latex-renderer-update-manager.service");
  try {
    await restore();
    await slots.atomic(backup, controllerState("read"), 0o600);
    await slots.begin();
    systemctl("start", "latex-renderer-update-manager.service");
    let ok = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await healthy();
        ok = true;
        break;
      } catch {
        await new Promise((r) => globalThis.setTimeout(r, 1000));
      }
    }
    if (!ok) throw new Error("New Updater did not become healthy");
    await slots.finish();
    await slots.collect();
  } catch (error) {
    systemctl("stop", "latex-renderer-update-manager.service");
    await restore();
    systemctl("start", "latex-renderer-update-manager.service");
    throw error;
  }
}
if (verb === "status") {
  const state = await slots.state();
  const { envelope } = await slots.verify(state.current);
  console.log(
    JSON.stringify({
      ...state,
      updaterVersion: envelope.version,
      updaterCommit: envelope.commit,
    }),
  );
} else if (verb === "recover") {
  await recoverPendingUpdater(slots, acquireMutationLock, restore);
} else {
  const lock = await acquireMutationLock();
  try {
    const protectedState = await slots.state();
    await slots.verify(protectedState.pending?.from ?? protectedState.current);
    await cleanupDownloads();
    if (verb === "upgrade") {
      const disk = await statfs("/opt/latex-renderer/update-staging");
      if (disk.bavail * disk.bsize < 4 * 1024 ** 3)
        throw new Error(
          "Insufficient space for bounded bootstrap download/extraction peak",
        );
      await mkdir("/opt/latex-renderer/update-staging", {
        recursive: true,
        mode: 0o711,
      });
      const stage = await mkdtemp(
        "/opt/latex-renderer/update-staging/updater-",
      );
      try {
        const release = await downloadPublishedRelease(version, stage);
        const envelope = JSON.parse(
          await readFile(
            join(release.source, ".latex-renderer-updater.json"),
            "utf8",
          ),
        );
        if (
          envelope.version !== release.version ||
          envelope.commit !== release.commit
        )
          throw new Error("Updater envelope differs from signed release");
        await slots.nominate(await slots.stage(release.source, envelope));
      } finally {
        await rm(stage, { recursive: true, force: true });
      }
    }
    await activate();
  } finally {
    await lock.release();
  }
}
