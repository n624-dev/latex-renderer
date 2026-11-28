#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import * as filesystem from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openBackupFile } from "./backup-boundary.mjs";
import {
  backupRetentionCandidates,
  isBackupRetentionProposal,
  listBackupArchives,
  planBackupRetention,
  readLastRetentionRun,
  readLiveBackupRetentionPolicy,
  readVerificationReceipt,
  retentionStatePath,
  runPostBackupRetention,
  verificationReceiptPath,
  withBackupStateLock,
  writeBackupState,
} from "./backup-retention.mjs";

const backup = "latex-renderer-backup.service";
const verify = "latex-renderer-backup-verify.service";

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

const maxRequestBytes = 512;
const defaultMinFreeStorageBytes = 5 * 1024 ** 3;

function parseRetentionOptions(input) {
  if (input === undefined)
    return { minFreeStorageBytes: defaultMinFreeStorageBytes };
  const options = JSON.parse(input);
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some(
      (key) => key !== "minFreeStorageBytes" && key !== "proposedPolicy",
    ) ||
    (Object.hasOwn(options, "minFreeStorageBytes") &&
      (!Number.isSafeInteger(options.minFreeStorageBytes) ||
        options.minFreeStorageBytes < 0)) ||
    (Object.hasOwn(options, "proposedPolicy") &&
      !isBackupRetentionProposal(options.proposedPolicy))
  )
    throw new Error("Invalid backup retention options");
  return { minFreeStorageBytes: defaultMinFreeStorageBytes, ...options };
}

export async function handleBackupRequest(
  message,
  {
    directory = process.env.BACKUP_DIRECTORY,
    databasePath = process.env.DATABASE_PATH,
    receiptPath = verificationReceiptPath,
    fs = filesystem,
    statfs = fs.statfs,
    now = new Date(),
    log = console.error,
    writeState = writeBackupState,
  } = {},
) {
  const match = /^(status|create|verify|retention|prune)(?: ([ -~]+))?\n$/.exec(
    message,
  );
  if (
    !match ||
    match[0] !== message ||
    Buffer.byteLength(message) > maxRequestBytes ||
    (match[2] !== undefined && match[1] !== "retention")
  )
    throw new Error("Invalid backup request");
  const [, action, input] = match;
  if (action === "retention" || action === "prune") {
    if (
      !directory ||
      directory !== resolve(directory) ||
      !databasePath ||
      databasePath !== resolve(databasePath)
    )
      throw new Error("Backup retention is not configured");
    const statePath = retentionStatePath(receiptPath);
    if (action === "prune")
      return await runPostBackupRetention({
        databasePath,
        directory,
        receiptPath,
        statePath,
        now,
        log,
        fs,
        writeState,
        lockTimeoutSeconds: 5,
      });
    const { minFreeStorageBytes, proposedPolicy } =
      parseRetentionOptions(input);
    const { policy, warning } = readLiveBackupRetentionPolicy(databasePath);
    const [archives, space, latestVerification, lastRun] = await Promise.all([
      listBackupArchives(directory, fs),
      statfs(directory, { bigint: true }),
      readVerificationReceipt(receiptPath, { fs }),
      readLastRetentionRun(statePath, { fs }),
    ]);
    archives.sort((left, right) => right.name.localeCompare(left.name));
    const freeBytes = space.bavail * space.bsize;
    const planOptions = {
      archives,
      now,
      latestVerifiedArchive: latestVerification?.archive,
    };
    const plan = planBackupRetention({ ...planOptions, policy });
    if (warning) plan.warnings.push(warning);
    return {
      archives,
      freeBytes: Number(freeBytes),
      latestVerification,
      schedule: "daily",
      policy,
      lastRun,
      candidates: backupRetentionCandidates({
        archives,
        freeBytes,
        minFreeStorageBytes,
      }),
      plan,
      proposedPlan:
        proposedPolicy === undefined
          ? null
          : planBackupRetention({ ...planOptions, policy: proposedPolicy }),
    };
  }

  if (action === "create") systemctl(["--no-block", "start", backup]);
  if (action === "verify") systemctl(["--no-block", "start", verify]);
  return {
    backup: state(backup),
    verification: state(verify),
    latestVerification: await readVerificationReceipt(receiptPath, { fs }),
  };
}

async function request() {
  let message = "";
  for await (const chunk of process.stdin) {
    message += chunk.toString("utf8");
    if (Buffer.byteLength(message) > maxRequestBytes)
      throw new Error("Invalid backup request");
    if (message.includes("\n")) break;
  }
  console.log(JSON.stringify(await handleBackupRequest(message)));
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
  const names = (await listBackupArchives(directory))
    .map(({ name }) => name)
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
  await writeBackupState(verificationReceiptPath, {
    archive,
    verifiedAt: new Date().toISOString(),
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  if (process.geteuid() !== 0 || process.argv.length !== 3)
    throw new Error("Invalid backup control invocation");
  if (process.argv[2] === "verify-latest")
    await withBackupStateLock(verificationReceiptPath, verifyLatest);
  else if (process.argv[2] === "request") {
    try {
      await request();
    } catch (error) {
      console.error(error);
      console.log('{"error":"BACKUP_CONTROL_FAILED"}');
      process.exitCode = 1;
    }
  } else throw new Error("Unknown backup control operation");
}
