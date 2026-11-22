#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { openBackupFile } from "./backup-boundary.mjs";

const backup = "latex-renderer-backup.service";
const verify = "latex-renderer-backup-verify.service";
const receipt = "/var/lib/latex-renderer-backup-verification/latest.json";
const archivePattern =
  /^latex-renderer-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z\.tar\.age$/;

function systemctl(args) {
  return execFileSync("/usr/bin/systemctl", args, {
    encoding: "utf8",
    timeout: 5000,
  });
}

function state(unit) {
  const text = systemctl(["show", "--property=ActiveState,Result", unit]);
  const active =
    /^ActiveState=(active|activating|deactivating|failed|inactive)$/m.exec(
      text,
    )?.[1];
  const result = /^Result=([a-z-]{1,32})$/m.exec(text)?.[1];
  return { active: active ?? "unknown", result: result ?? "unknown" };
}

async function latestVerification() {
  try {
    const info = await lstat(receipt);
    if (
      !info.isFile() ||
      info.uid !== 0 ||
      info.mode & 0o077 ||
      info.size > 4096
    )
      return null;
    const record = JSON.parse(await readFile(receipt, "utf8"));
    if (
      archivePattern.test(record.archive) &&
      typeof record.verifiedAt === "string"
    )
      return { archive: record.archive, verifiedAt: record.verifiedAt };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

async function request() {
  let message = "";
  for await (const chunk of process.stdin) {
    message += chunk.toString("ascii");
    if (message.length > 16) throw new Error("Invalid backup request");
    if (message.endsWith("\n")) break;
  }
  switch (message) {
    case "create\n":
      systemctl(["--no-block", "start", backup]);
      break;
    case "verify\n":
      systemctl(["--no-block", "start", verify]);
      break;
    case "status\n":
      break;
    default:
      throw new Error("Invalid backup request");
  }
  console.log(
    JSON.stringify({
      backup: state(backup),
      verification: state(verify),
      latestVerification: await latestVerification(),
    }),
  );
}

async function verifyLatest() {
  const directory = process.env.BACKUP_DIRECTORY;
  const credentials = process.env.CREDENTIALS_DIRECTORY;
  if (
    !directory ||
    !credentials ||
    !isAbsolute(directory) ||
    !isAbsolute(credentials)
  )
    throw new Error("Backup verification is not configured");
  const names = (await readdir(directory))
    .filter((name) => archivePattern.test(name))
    .sort();
  const archive = names.at(-1);
  if (!archive) throw new Error("Create a completed backup first");
  const handle = await openBackupFile(directory, archive);
  try {
    execFileSync(
      "/usr/local/bin/node",
      [
        "deploy/scripts/restore-test.mjs",
        `/proc/${process.pid}/fd/${handle.fd}`,
      ],
      {
        env: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          BACKUP_AGE_IDENTITY_FILE: join(credentials, "age-identity"),
        },
        stdio: "inherit",
      },
    );
  } finally {
    await handle.close();
  }
  await writeFile(
    `${receipt}.part`,
    JSON.stringify({ archive, verifiedAt: new Date().toISOString() }) + "\n",
    { mode: 0o600 },
  );
  await rename(`${receipt}.part`, receipt);
}

if (process.geteuid() !== 0 || process.argv.length !== 3)
  throw new Error("Invalid backup control invocation");
if (process.argv[2] === "verify-latest") await verifyLatest();
else if (process.argv[2] === "request") {
  try {
    await request();
  } catch {
    console.log('{"error":"BACKUP_CONTROL_FAILED"}');
    process.exitCode = 1;
  }
} else throw new Error("Unknown backup control operation");
