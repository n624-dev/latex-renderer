#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  readAuditCheckpoint,
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
let checkpoint = await initialCheckpoint();
const database = new DatabaseSync(databasePath, { readOnly: true });
const selectBatch = database.prepare(
  `SELECT id,actor_type,actor_id,action,target_type,target_id,result,
          ip_address,user_agent,metadata_json,created_at
   FROM audit_logs
   WHERE created_at>? OR (created_at=? AND id>?)
   ORDER BY created_at,id LIMIT ?`,
);
const work = await mkdtemp(join(tmpdir(), "latex-audit-"));
let exported = 0;
let batches = 0;
try {
  for (; batches < maxBatches; batches += 1) {
    const rows = selectBatch.all(
      checkpoint.createdAt,
      checkpoint.createdAt,
      checkpoint.id,
      batchSize,
    );
    if (rows.length === 0) break;
    const stamp = new Date().toISOString().replaceAll(":", "-");
    const suffix = String(batches + 1).padStart(3, "0");
    const jsonl = join(work, `audit-${stamp}-${suffix}.jsonl`);
    await writeFile(
      jsonl,
      `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
      { mode: 0o600 },
    );
    const last = rows.at(-1);
    const lastId = String(last.id).replaceAll(/[^A-Za-z0-9_-]/g, "_");
    const output = join(
      destination,
      `${basename(jsonl)}-${lastId}.age`,
    );
    const partial = `${output}.part-${process.pid}`;
    try {
      await run("age", ["-R", recipient, "-o", partial, jsonl]);
      if ((await stat(partial)).size === 0)
        throw new Error("Encrypted audit export is empty");
      await rename(partial, output);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      throw error;
    }
    await uploadIfConfigured(output);
    checkpoint = {
      createdAt: String(last.created_at),
      id: String(last.id),
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
  database.close();
  await rm(work, { recursive: true, force: true });
}

console.log(
  JSON.stringify({
    event: exported === 0 ? "audit_export.no_changes" : "audit_export.completed",
    count: exported,
    batches,
    backlogMayRemain: batches >= maxBatches,
  }),
);

async function initialCheckpoint() {
  const current = await readAuditCheckpoint(checkpointPath);
  if (
    current.createdAt !== "" ||
    process.env.AUDIT_EXPORT_CHECKPOINT !== undefined
  )
    return current;
  const legacy = await readAuditCheckpoint(
    join(destination, "audit-export.checkpoint"),
  );
  if (legacy.createdAt !== "")
    await writeAuditCheckpoint(checkpointPath, legacy);
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

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
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
