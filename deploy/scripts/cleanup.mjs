#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readAuditCheckpoint } from "./audit-checkpoint.mjs";
import {
  boundedIntegerEnvironment,
  positiveIntegerEnvironment,
} from "./environment.mjs";

const databasePath = required("DATABASE_PATH");
const storageRoot = required("STORAGE_ROOT");
const artifactHours = positive("ARTIFACT_RETENTION_HOURS", 24);
const historyDays = positive("JOB_HISTORY_RETENTION_DAYS", 30);
const auditRetentionDays = positive("AUDIT_LOG_RETENTION_DAYS", 365);
const auditPruneBatchSize = boundedIntegerEnvironment(
  process.env,
  "AUDIT_PRUNE_BATCH_SIZE",
  10_000,
  1,
  100_000,
);
const auditCheckpointPath =
  process.env.AUDIT_EXPORT_CHECKPOINT ??
  join(dirname(databasePath), "audit", "export.checkpoint");
const db = new DatabaseSync(databasePath, {
  enableForeignKeyConstraints: true,
});
db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");

const itemFailures = [];
let itemFailureCount = 0;
const now = new Date().toISOString();
const staleJobUploadsRecovered = recoverStaleJobUploads(now),
  staleSourceUploadsRecovered = recoverStaleSourceUploads(now);
const reservationCutoff = new Date(
  Date.now() - positive("UPLOAD_RESERVATION_MINUTES", 30) * 60_000,
).toISOString();
db.prepare(
  `UPDATE jobs SET status='expired',render_status='expired',completed_at=?,updated_at=?,error_code='UPLOAD_EXPIRED'
  WHERE status IN ('reserved','uploading') AND updated_at<?
  AND NOT EXISTS (SELECT 1 FROM used_nonces n WHERE n.job_id=jobs.id
                  AND n.state='claimed' AND n.claim_expires_at>?)`,
).run(now, now, reservationCutoff, now);
db.prepare(
  `UPDATE used_nonces SET state='expired',claim_owner=NULL,claimed_at=NULL,claim_expires_at=NULL
   WHERE expires_at<? AND state IN ('unused','released')`,
).run(now);
db.prepare(
  `UPDATE sources SET status='expired',updated_at=? WHERE status IN ('reserved','uploading') AND expires_at<?
   AND NOT EXISTS (SELECT 1 FROM source_upload_nonces n WHERE n.source_id=sources.id
                   AND n.state='claimed' AND n.claim_expires_at>?)
   AND NOT EXISTS (SELECT 1 FROM jobs j JOIN used_nonces n ON n.job_id=j.id
                   WHERE j.source_id=sources.id AND n.state='claimed' AND n.claim_expires_at>?)`,
).run(now, now, now, now);
db.prepare(
  `UPDATE source_upload_nonces SET state='expired',claim_owner=NULL,claimed_at=NULL,claim_expires_at=NULL
   WHERE expires_at<? AND state IN ('unused','released')`,
).run(now);
db.prepare("DELETE FROM artifact_download_leases WHERE expires_at<?").run(now);
db.prepare(
  "DELETE FROM used_nonces WHERE expires_at<? AND state!='claimed'",
).run(now);
db.prepare(
  "DELETE FROM source_upload_nonces WHERE expires_at<? AND state!='claimed'",
).run(now);
db.prepare("DELETE FROM revoked_tickets WHERE expires_at<?").run(now);
db.prepare("DELETE FROM idempotency_records WHERE expires_at<?").run(now);
const remoteCodesDeleted = Number(
    db
      .prepare("DELETE FROM remote_mcp_authorization_codes WHERE expires_at<=?")
      .run(now).changes,
  ),
  remoteTokensDeleted = Number(
    db
      .prepare(
        "DELETE FROM remote_mcp_tokens WHERE expires_at<=? OR revoked_at IS NOT NULL",
      )
      .run(now).changes,
  ),
  remoteFamiliesDeleted = Number(
    db
      .prepare(
        `DELETE FROM remote_mcp_token_families
         WHERE (expires_at<=? OR revoked_at IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM remote_mcp_tokens WHERE family_id=remote_mcp_token_families.id)`,
      )
      .run(now).changes,
  ),
  sourceRefsDeleted = Number(
    db
      .prepare(
        "DELETE FROM source_refs WHERE expires_at<=? OR revoked_at IS NOT NULL",
      )
      .run(now).changes,
  ),
  rateWindowsDeleted = Number(
    db
      .prepare("DELETE FROM remote_mcp_rate_limits WHERE window_start<?")
      .run(new Date(Date.now() - 2 * 3_600_000).toISOString()).changes,
  );

const cutoff = new Date(Date.now() - artifactHours * 3_600_000).toISOString();
const terminalStatuses =
    "'succeeded','failed','timeout','canceled','rejected','expired'",
  maxCleanupAttempts = 10;
const jobs = db
  .prepare(
    `SELECT j.id FROM jobs j WHERE (
      (j.deletion_status='retained' AND j.status IN (${terminalStatuses})
       AND COALESCE(j.completed_at,j.updated_at)<?)
      OR (j.status='deleting' AND j.deletion_status IN ('retained','pending','deleting'))
      OR (j.deletion_status IN ('pending','deleting','retry')
          AND (j.deletion_next_attempt_at IS NULL OR j.deletion_next_attempt_at<=?))
    ) AND NOT EXISTS
    (SELECT 1 FROM artifact_download_leases l WHERE l.job_id=j.id AND l.expires_at>?)
    ORDER BY COALESCE(j.deletion_next_attempt_at,j.completed_at,j.updated_at),j.id LIMIT 100`,
  )
  .all(cutoff, now, now);
let artifactsDeleted = 0;
for (const record of jobs) {
  const id = String(record.id);
  try {
    db.exec("BEGIN IMMEDIATE");
    const changed = db
      .prepare(
        `UPDATE jobs SET
          render_status=COALESCE(render_status,CASE WHEN status IN (${terminalStatuses}) THEN status END),
          status='deleting',deletion_status='deleting',deletion_attempts=deletion_attempts+1,
          deletion_error=NULL,deletion_next_attempt_at=NULL,updated_at=?
        WHERE id=? AND (
          (deletion_status='retained' AND status IN (${terminalStatuses})
           AND COALESCE(completed_at,updated_at)<?)
          OR (status='deleting' AND deletion_status IN ('retained','pending','deleting'))
          OR (deletion_status IN ('pending','deleting','retry')
              AND (deletion_next_attempt_at IS NULL OR deletion_next_attempt_at<=?))
        ) AND NOT EXISTS
          (SELECT 1 FROM artifact_download_leases WHERE job_id=? AND expires_at>?)`,
      )
      .run(now, id, cutoff, now, id, now);
    db.exec("COMMIT");
    if (changed.changes !== 1) continue;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    recordFailure("job-claim", id, error);
    continue;
  }
  try {
    const sourceStorage = db
      .prepare(
        `SELECT s.storage_key FROM jobs j LEFT JOIN sources s ON s.id=j.source_id WHERE j.id=?`,
      )
      .get(id)?.storage_key;
    if (sourceStorage === `jobs/${id}/input/source.zip`) {
      for (const child of ["output", "work", "staging", "attempts"])
        await rm(join(storageRoot, "jobs", id, child), {
          recursive: true,
          force: true,
        });
    } else
      await rm(join(storageRoot, "jobs", id), { recursive: true, force: true });
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM artifacts WHERE job_id=?").run(id);
    const source = db.prepare("SELECT source_id FROM jobs WHERE id=?").get(id);
    const deleted = db
      .prepare(
        `UPDATE jobs SET status='deleted',deletion_status='deleted',deletion_error=NULL,
         deletion_next_attempt_at=NULL,deleted_at=?,updated_at=?
         WHERE id=? AND status='deleting' AND deletion_status='deleting'`,
      )
      .run(now, now, id);
    if (deleted.changes !== 1)
      throw new Error("Job deletion ownership changed concurrently");
    if (source?.source_id)
      db.prepare(
        `UPDATE sources SET expires_at=?,updated_at=? WHERE id=? AND status='ready'
      AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=? AND status NOT IN ('deleted','expired'))`,
      ).run(now, now, String(source.source_id), String(source.source_id));
    db.exec("COMMIT");
    artifactsDeleted += 1;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    try {
      const attempt = cleanupAttempt("jobs", id),
        retry = attempt < maxCleanupAttempts;
      db.prepare(
        `UPDATE jobs SET status=COALESCE(render_status,status),deletion_status=?,
           deletion_error=?,deletion_next_attempt_at=?,updated_at=?
           WHERE id=? AND status='deleting' AND deletion_status='deleting'`,
      ).run(
        retry ? "retry" : "failed",
        errorMessage(error),
        retry ? nextRetry(attempt) : null,
        now,
        id,
      );
    } catch (recordError) {
      recordFailure("job-failure-record", id, recordError);
    }
    recordFailure("job-delete", id, error);
  }
}

const sources = db
  .prepare(
    `SELECT id,storage_key FROM sources s WHERE (
      (deletion_status='retained' AND status IN ('ready','expired') AND expires_at<=?)
      OR (status='deleting' AND deletion_status IN ('retained','pending','deleting'))
      OR (deletion_status IN ('pending','deleting','retry')
          AND (deletion_next_attempt_at IS NULL OR deletion_next_attempt_at<=?))
    ) AND NOT EXISTS
      (SELECT 1 FROM jobs j WHERE j.source_id=s.id AND j.status NOT IN ('deleted','expired'))
    AND NOT EXISTS (SELECT 1 FROM project_revisions r JOIN projects p ON p.id=r.project_id
                    WHERE r.source_id=s.id AND p.deleted_at IS NULL)
    ORDER BY COALESCE(deletion_next_attempt_at,expires_at,updated_at),id LIMIT 100`,
  )
  .all(now, now);
let sourcesDeleted = 0;
for (const record of sources) {
  const id = String(record.id),
    storageKey = String(record.storage_key);
  try {
    db.exec("BEGIN IMMEDIATE");
    const changed = db
      .prepare(
        `UPDATE sources SET status='deleting',deletion_status='deleting',
         deletion_attempts=deletion_attempts+1,deletion_error=NULL,
         deletion_next_attempt_at=NULL,updated_at=? WHERE id=? AND (
          (deletion_status='retained' AND status IN ('ready','expired') AND expires_at<=?)
          OR (status='deleting' AND deletion_status IN ('retained','pending','deleting'))
          OR (deletion_status IN ('pending','deleting','retry')
              AND (deletion_next_attempt_at IS NULL OR deletion_next_attempt_at<=?))
        )
    AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=? AND status NOT IN ('deleted','expired'))
    AND NOT EXISTS (SELECT 1 FROM project_revisions r JOIN projects p ON p.id=r.project_id
                    WHERE r.source_id=? AND p.deleted_at IS NULL)`,
      )
      .run(now, id, now, now, id, id);
    db.exec("COMMIT");
    if (changed.changes !== 1) continue;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    recordFailure("source-claim", id, error);
    continue;
  }
  try {
    if (isAbsolute(storageKey) || storageKey.split("/").includes(".."))
      throw new Error("Unsafe source storage key");
    if (storageKey === `sources/${id}/source.zip`)
      await rm(join(storageRoot, "sources", id), {
        recursive: true,
        force: true,
      });
    else await rm(join(storageRoot, storageKey), { force: true });
    const deleted = db
      .prepare(
        `UPDATE sources SET status='deleted',deletion_status='deleted',deletion_error=NULL,
       deletion_next_attempt_at=NULL,deleted_at=?,updated_at=?
       WHERE id=? AND status='deleting' AND deletion_status='deleting'
       AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=? AND status NOT IN ('deleted','expired'))
       AND NOT EXISTS (SELECT 1 FROM project_revisions r JOIN projects p ON p.id=r.project_id
                       WHERE r.source_id=? AND p.deleted_at IS NULL)`,
      )
      .run(now, now, id, id, id);
    if (deleted.changes !== 1)
      throw new Error("Source deletion ownership changed concurrently");
    sourcesDeleted += 1;
  } catch (error) {
    try {
      const attempt = cleanupAttempt("sources", id),
        retry = attempt < maxCleanupAttempts;
      db.prepare(
        `UPDATE sources SET status='expired',deletion_status=?,deletion_error=?,
           deletion_next_attempt_at=?,updated_at=?
           WHERE id=? AND status='deleting' AND deletion_status='deleting'`,
      ).run(
        retry ? "retry" : "failed",
        errorMessage(error),
        retry ? nextRetry(attempt) : null,
        now,
        id,
      );
    } catch (recordError) {
      recordFailure("source-failure-record", id, recordError);
    }
    recordFailure("source-delete", id, error);
  }
}

const historyCutoff = new Date(
  Date.now() - historyDays * 86_400_000,
).toISOString();
const old = db
  .prepare(
    "SELECT id FROM jobs WHERE status='deleted' AND deleted_at<? LIMIT 1000",
  )
  .all(historyCutoff)
  .map((row) => String(row.id));
let historyDeleted = 0;
for (const id of old) {
  try {
    db.exec("BEGIN IMMEDIATE");
    db.prepare(
      "UPDATE jobs SET retry_of_job_id=NULL WHERE retry_of_job_id=?",
    ).run(id);
    db.prepare("DELETE FROM used_nonces WHERE job_id=?").run(id);
    const deleted = db
      .prepare("DELETE FROM jobs WHERE id=? AND status='deleted'")
      .run(id);
    if (deleted.changes !== 1)
      throw new Error("Job history deletion changed concurrently");
    db.exec("COMMIT");
    historyDeleted += 1;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    recordFailure("job-history-delete", id, error);
  }
}
let auditLogsDeleted = 0;
try {
  const checkpoint = await readAuditCheckpoint(auditCheckpointPath);
  if (checkpoint.createdAt !== "") {
    const auditCutoff = new Date(
      Date.now() - auditRetentionDays * 86_400_000,
    ).toISOString();
    auditLogsDeleted = Number(
      db
        .prepare(
          `DELETE FROM audit_logs WHERE id IN (
             SELECT id FROM audit_logs
             WHERE created_at<?
               AND (created_at<? OR (created_at=? AND id<=?))
             ORDER BY created_at,id LIMIT ?
           )`,
        )
        .run(
          auditCutoff,
          checkpoint.createdAt,
          checkpoint.createdAt,
          checkpoint.id,
          auditPruneBatchSize,
        ).changes,
    );
  }
} catch (error) {
  recordFailure("audit-prune", "audit_logs", error);
}
console.log(
  JSON.stringify({
    event: "cleanup.completed",
    result: itemFailureCount === 0 ? "success" : "partial",
    artifactsDeleted,
    sourcesDeleted,
    historyDeleted,
    auditLogsDeleted,
    staleJobUploadsRecovered,
    staleSourceUploadsRecovered,
    itemFailureCount,
    itemFailures,
    remoteCodesDeleted,
    remoteTokensDeleted,
    remoteFamiliesDeleted,
    sourceRefsDeleted,
    rateWindowsDeleted,
  }),
);
db.close();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
function positive(name, fallback) {
  return positiveIntegerEnvironment(process.env, name, fallback);
}

function cleanupAttempt(table, id) {
  const row = db
    .prepare(`SELECT deletion_attempts FROM ${table} WHERE id=?`)
    .get(id);
  return Number(row?.deletion_attempts ?? maxCleanupAttempts);
}

function nextRetry(attempt) {
  const delaySeconds = Math.min(300 * 2 ** Math.max(0, attempt - 1), 86_400);
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  // eslint-disable-next-line no-control-regex -- persisted errors are untrusted process/filesystem text.
  return message.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 500);
}

function recordFailure(stage, id, error) {
  itemFailureCount += 1;
  if (itemFailures.length < 100)
    itemFailures.push({ stage, id, error: errorMessage(error) });
}

function recoverStaleJobUploads(timestamp) {
  const stale = db
    .prepare(
      `SELECT nonce,job_id,claim_owner FROM used_nonces
       WHERE state='claimed' AND (claim_expires_at IS NULL OR claim_expires_at<=?)`,
    )
    .all(timestamp);
  let recovered = 0;
  for (const row of stale) {
    const nonce = String(row.nonce),
      jobId = String(row.job_id),
      owner = String(row.claim_owner ?? "");
    try {
      db.exec("BEGIN IMMEDIATE");
      const changed = db
        .prepare(
          `UPDATE used_nonces SET
           state=CASE WHEN expires_at>? THEN 'released' ELSE 'expired' END,
           claim_owner=NULL,claimed_at=NULL,claim_expires_at=NULL
           WHERE nonce=? AND state='claimed' AND claim_owner=?
           AND (claim_expires_at IS NULL OR claim_expires_at<=?)`,
        )
        .run(timestamp, nonce, owner, timestamp);
      if (changed.changes === 1) {
        db.prepare(
          "UPDATE jobs SET status='reserved',updated_at=? WHERE id=? AND status='uploading'",
        ).run(timestamp, jobId);
        db.prepare(
          `UPDATE sources SET status='reserved',updated_at=?
           WHERE id=(SELECT source_id FROM jobs WHERE id=?) AND status='uploading'`,
        ).run(timestamp, jobId);
        recovered += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      recordFailure("job-upload-recovery", jobId, error);
    }
  }
  return recovered;
}

function recoverStaleSourceUploads(timestamp) {
  const stale = db
    .prepare(
      `SELECT nonce,source_id,claim_owner FROM source_upload_nonces
       WHERE state='claimed' AND (claim_expires_at IS NULL OR claim_expires_at<=?)`,
    )
    .all(timestamp);
  let recovered = 0;
  for (const row of stale) {
    const nonce = String(row.nonce),
      sourceId = String(row.source_id),
      owner = String(row.claim_owner ?? "");
    try {
      db.exec("BEGIN IMMEDIATE");
      const changed = db
        .prepare(
          `UPDATE source_upload_nonces SET
           state=CASE WHEN expires_at>? THEN 'released' ELSE 'expired' END,
           claim_owner=NULL,claimed_at=NULL,claim_expires_at=NULL
           WHERE nonce=? AND state='claimed' AND claim_owner=?
           AND (claim_expires_at IS NULL OR claim_expires_at<=?)`,
        )
        .run(timestamp, nonce, owner, timestamp);
      if (changed.changes === 1) {
        db.prepare(
          "UPDATE sources SET status='reserved',updated_at=? WHERE id=? AND status='uploading'",
        ).run(timestamp, sourceId);
        recovered += 1;
      }
      db.exec("COMMIT");
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      recordFailure("source-upload-recovery", sourceId, error);
    }
  }
  return recovered;
}
