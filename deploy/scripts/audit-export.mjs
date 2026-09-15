#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  readAuditCheckpoint,
  readAuditDatabaseState,
  syncAuditDirectory,
  validateAuditCheckpoint,
  writeAuditCheckpoint,
} from "./audit-checkpoint.mjs";
import { boundedIntegerEnvironment } from "./environment.mjs";

const databasePath = required("DATABASE_PATH");
const destination = required("BACKUP_DIRECTORY");
const recipient = required("BACKUP_AGE_RECIPIENT_FILE");
const checkpointPath =
  process.env.AUDIT_EXPORT_CHECKPOINT ??
  join(dirname(databasePath), "audit", "export.checkpoint");
const batchSize = boundedIntegerEnvironment(
  process.env,
  "AUDIT_EXPORT_BATCH_SIZE",
  10_000,
  1,
  10_000,
);
const maxBatches = boundedIntegerEnvironment(
  process.env,
  "AUDIT_EXPORT_MAX_BATCHES",
  20,
  1,
  100,
);

await mkdir(destination, { recursive: true, mode: 0o700 });
const lockDirectory = join(dirname(databasePath), "audit");
await mkdir(lockDirectory, { recursive: true, mode: 0o700 });
// The kernel lock survives the short flock child through its shared open file
// description and is released even on SIGKILL. Never unlink this lock file.
const lock = await open(
  join(lockDirectory, "export.lock"),
  constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,
  0o600,
);
let database, work;
let exported = 0;
let batches = 0;
let legacyReplay;
try {
  if (!(await lock.stat()).isFile())
    throw new Error("Invalid audit export lock file");
  await run("flock", ["--exclusive", "--nonblock", "3"], lock.fd);
  database = new DatabaseSync(databasePath, { readOnly: true });
  database.exec("PRAGMA busy_timeout=5000; BEGIN");
  const state = readAuditDatabaseState(database);
  const initial = await initialCheckpoint();
  legacyReplay = initial.format === 1 || initial.format === 2;
  let checkpoint =
    initial.format === 3
      ? validateAuditCheckpoint(database, initial, state)
      : { format: 3, databaseId: state.databaseId, sequence: "0", token: "" };
  database.exec("COMMIT");
  const selectBatch = database.prepare(
    `SELECT a.id,a.actor_type,a.actor_id,a.action,a.target_type,a.target_id,a.result,
            a.ip_address,a.user_agent,a.metadata_json,a.created_at,
            CAST(e.sequence AS TEXT) AS export_sequence,e.token AS export_token
     FROM audit_export_sequence e JOIN audit_logs a ON a.id=e.audit_id
     WHERE e.sequence>? ORDER BY e.sequence LIMIT ?`,
  );
  work = await mkdtemp(join(tmpdir(), "latex-audit-"));
  for (; batches < maxBatches; batches += 1) {
    database.exec("BEGIN");
    validateAuditCheckpoint(database, checkpoint);
    const rows = selectBatch.all(BigInt(checkpoint.sequence), batchSize);
    database.exec("COMMIT");
    if (rows.length === 0) {
      // Empty legacy databases also transition once; sequence zero acknowledges
      // no rows and therefore cannot allow unexported rows to be pruned.
      if (checkpoint.sequence === "0" && initial.format !== 3)
        await writeAuditCheckpoint(checkpointPath, checkpoint);
      break;
    }
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const suffix = String(batches + 1).padStart(3, "0");
    const jsonl = join(work, `audit-${stamp}-${suffix}.jsonl`);
    await writeFile(
      jsonl,
      `${rows.map((row) => JSON.stringify({ ...row, export_database_id: state.databaseId })).join("\n")}\n`,
      { mode: 0o600 },
    );
    const last = rows.at(-1);
    const output = join(
      destination,
      `${basename(jsonl)}-${last.export_sequence}-${randomUUID()}.age`,
    );
    const partial = `${output}.part-${process.pid}`;
    try {
      await run("age", ["-R", recipient, "-o", partial, jsonl]);
      if ((await stat(partial)).size === 0)
        throw new Error("Encrypted audit export is empty");
      const encrypted = await open(partial, "r");
      try {
        await encrypted.sync();
      } finally {
        await encrypted.close();
      }
      await rename(partial, output);
      await syncAuditDirectory(destination);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      throw error;
    }
    await uploadIfConfigured(output);
    checkpoint = {
      format: 3,
      databaseId: state.databaseId,
      sequence: String(last.export_sequence),
      token: String(last.export_token),
    };
    await writeAuditCheckpoint(checkpointPath, checkpoint);
    exported += rows.length;
    await rm(jsonl, { force: true });
    if (rows.length < batchSize) {
      batches += 1;
      break;
    }
  }
} finally {
  database?.close();
  if (work) await rm(work, { recursive: true, force: true });
  await lock.close();
}

console.log(
  JSON.stringify({
    event:
      exported === 0 ? "audit_export.no_changes" : "audit_export.completed",
    count: exported,
    batches,
    backlogMayRemain: batches >= maxBatches,
    legacyReplay,
  }),
);

async function initialCheckpoint() {
  const current = await readAuditCheckpoint(checkpointPath);
  if (current.format !== 0 || process.env.AUDIT_EXPORT_CHECKPOINT !== undefined)
    return current;
  const legacy = await readAuditCheckpoint(
    join(destination, "audit-export.checkpoint"),
  );
  return legacy;
}

async function uploadIfConfigured(path) {
  const executable = process.env.BACKUP_UPLOAD_EXECUTABLE;
  if (!executable) return;
  const args = JSON.parse(process.env.BACKUP_UPLOAD_ARGS_JSON ?? "[]");
  if (
    !Array.isArray(args) ||
    args.length > 100 ||
    !args.every((value) => typeof value === "string" && value.length <= 4096)
  )
    throw new Error("BACKUP_UPLOAD_ARGS_JSON must be a bounded string array");
  await run(executable, [...args, path]);
}

function run(command, args, lockFd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio:
        lockFd === undefined
          ? ["ignore", "ignore", "pipe"]
          : ["ignore", "ignore", "pipe", lockFd],
      shell: false,
    });
    let error = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (error.length < 8192) error += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} failed: ${error}`)),
    );
  });
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
