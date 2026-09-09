import { execFileSync, spawn } from "node:child_process";
import { chmod, chown, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout, clearTimeout } from "node:timers";
import {
  prepareApplicationDatabase,
  applicationDatabaseIdentity,
} from "../scripts/application-database-file.mjs";

if (
  process.getuid() !== 0 ||
  process.env.RUNNER_ENVIRONMENT !== "github-hosted" ||
  process.env.GITHUB_ACTIONS !== "true"
)
  throw new Error("Database access probe is restricted to disposable CI hosts");
const marker = JSON.parse(
  await readFile("/etc/latex-renderer-ci-host.json", "utf8"),
);
if (
  marker.runId !== process.env.GITHUB_RUN_ID ||
  marker.bootId !==
    (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim()
)
  throw new Error("Database probe host marker mismatch");
const identity = applicationDatabaseIdentity();
const workerUid = Number(
  execFileSync("id", ["-u", "latex-render-worker"], {
    encoding: "utf8",
  }).trim(),
);
if (
  ![identity.uid, workerUid].every(
    (uid) => Number.isSafeInteger(uid) && uid > 0,
  ) ||
  identity.uid === workerUid
)
  throw new Error("Database probe requires distinct non-root service users");
const root = await mkdtemp("/var/lib/latex-renderer/ci-db-probe-");
const path = join(root, "renderer.sqlite3");
let holder;
let holderClosed;
try {
  await chown(root, 0, identity.gid);
  await chmod(root, 0o2770);
  const options = (uid) => ({
    uid,
    gid: identity.gid,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
    encoding: "utf8",
    timeout: 10000,
  });
  const prefix =
    "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(process.argv[1]);";
  execFileSync(
    "/usr/local/bin/node",
    [
      "-e",
      prefix +
        "db.exec('PRAGMA journal_mode=WAL; CREATE TABLE t(value)');db.close()",
      path,
    ],
    options(identity.uid),
  );
  await chmod(path, 0o640);
  let refused = false;
  try {
    execFileSync(
      "/usr/local/bin/node",
      ["-e", prefix + "db.exec('INSERT INTO t VALUES(0)');db.close()", path],
      options(workerUid),
    );
  } catch (error) {
    if (!String(error.stderr).includes("readonly database")) throw error;
    refused = true;
  }
  if (!refused)
    throw new Error("Readonly database regression did not reproduce");
  await prepareApplicationDatabase(path, identity);
  holder = spawn(
    "/usr/local/bin/node",
    [
      "-e",
      prefix +
        "db.exec('INSERT INTO t VALUES(1)');console.log('ready');process.stdin.resume();process.stdin.on('end',()=>{db.close()})",
      path,
    ],
    { ...options(identity.uid), stdio: ["pipe", "pipe", "pipe"] },
  );
  holderClosed = new Promise((resolve) => holder.once("close", resolve));
  holder.stderr.resume();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Database holder did not become ready")),
      5000,
    );
    holder.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    holder.stdout.once("data", (data) => {
      clearTimeout(timer);
      String(data).trim() === "ready"
        ? resolve()
        : reject(new Error("Invalid database holder response"));
    });
    holder.once("exit", () => {
      clearTimeout(timer);
      reject(new Error("Database holder exited before readiness"));
    });
  });
  const count = execFileSync(
    "/usr/local/bin/node",
    [
      "-e",
      prefix +
        "db.exec('INSERT INTO t VALUES(2)');console.log(db.prepare('SELECT COUNT(*) AS n FROM t').get().n);db.close()",
      path,
    ],
    options(workerUid),
  ).trim();
  if (count !== "2")
    throw new Error("Shared service-user database writes failed");
  for (const suffix of ["", "-wal", "-shm"])
    if (((await stat(path + suffix)).mode & 0o777) !== 0o660)
      throw new Error("Shared SQLite file permissions differ");
  holder.stdin.end();
  if ((await holderClosed) !== 0)
    throw new Error("Database holder failed on close");
  console.log(
    "Database access probe passed: distinct service users, live WAL/SHM, readonly regression reproduced and repaired.",
  );
} finally {
  if (holder && holder.exitCode === null && holder.signalCode === null) {
    holder.kill("SIGTERM");
    await holderClosed;
  }
  await rm(root, { recursive: true, force: true });
}
