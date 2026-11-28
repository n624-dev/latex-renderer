#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { pruneServiceDiagnostics } from "./service-diagnostics.mjs";
import { sourceReferenceCountSql } from "../../packages/database/dist/source-lifecycle.js";
import { collectSourceTrees } from "./source-tree-gc.mjs";
import { claimUnprotectedSources } from "./backup-source-protection.mjs";
import {
  readAuditCheckpoint,
  validateAuditCheckpoint,
} from "./audit-checkpoint.mjs";
import {
  boundedIntegerEnvironment,
  positiveIntegerEnvironment,
} from "./environment.mjs";

const databasePath = required("DATABASE_PATH");
const storageRoot = required("STORAGE_ROOT");
const cleanupBatchSize = 100;
const cleanupDeadline =
  performance.now() + positive("CLEANUP_MAX_RUN_SECONDS", 600) * 1000;
let budgetStopped = false;
try {
  await pruneServiceDiagnostics(storageRoot);
} catch {
  console.error(
    JSON.stringify({ event: "service_diagnostics.cleanup_failed" }),
  );
}
const artifactHours = positive("ARTIFACT_RETENTION_HOURS", 24);
const draftHours = Math.min(
  artifactHours,
  positive("DRAFT_PREVIEW_RETENTION_HOURS", artifactHours),
);
const draftGenerations = boundedIntegerEnvironment(
  process.env,
  "DRAFT_PREVIEW_KEEP_GENERATIONS",
  3,
  0,
  1000,
);
const draftProjectBytes = boundedIntegerEnvironment(
  process.env,
  "DRAFT_PREVIEW_MAX_RETAINED_BYTES_PER_PROJECT",
  32 * 1024 ** 2,
  0,
  Number.MAX_SAFE_INTEGER,
);
const historyDays = positive("JOB_HISTORY_RETENTION_DAYS", 30);
const sourceHistoryDays = positive("SOURCE_HISTORY_RETENTION_DAYS", 30);
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
// Resolve the current schema before any filesystem deletion. An interrupted
// application migration must not erase outputs while SQL still cannot retire them.
const deleteDraftCacheAccounting = db.prepare(
  "DELETE FROM draft_work_cache WHERE job_id=?",
);

const itemFailures = [];
let itemFailureCount = 0;
const now = new Date().toISOString();
try {
  await collectSourceTrees(db, storageRoot);
} catch {
  recordFailure(
    "source-tree-gc",
    "bounded-cache",
    new Error("Source tree collection failed"),
  );
}
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
db.prepare("DELETE FROM artifact_download_leases WHERE expires_at<=?").run(now);
db.prepare(
  "DELETE FROM used_nonces WHERE expires_at<? AND state!='claimed'",
).run(now);
db.prepare(
  "DELETE FROM source_upload_nonces WHERE expires_at<? AND state!='claimed'",
).run(now);
db.prepare("DELETE FROM revoked_tickets WHERE expires_at<?").run(now);
db.prepare("DELETE FROM idempotency_records WHERE expires_at<?").run(now);
const remoteLoginContinuationsDeleted = Number(
  db
    .prepare("DELETE FROM remote_mcp_login_continuations WHERE expires_at<=?")
    .run(now).changes,
);
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
let draftPreviewsScheduled = 0;
try {
  const draftCutoff = new Date(
    Date.parse(now) - draftHours * 3_600_000,
  ).toISOString();
  draftPreviewsScheduled = Number(
    db
      .prepare(
        `
    WITH terminal_drafts AS (
      SELECT j.id,d.project_id,d.draft_version,j.created_at,
        COALESCE(j.completed_at,j.updated_at) AS finished_at,
        j.error_code,p.deleted_at AS project_deleted,
        (j.status='succeeded' AND EXISTS (
          SELECT 1 FROM artifacts a WHERE a.job_id=j.id AND a.type='pdf' AND a.relative_path='result.pdf'
        )) AS usable_pdf,
        COALESCE((SELECT SUM(a.size) FROM artifacts a WHERE a.job_id=j.id),0) +
          COALESCE((SELECT SUM(w.bytes) FROM draft_work_cache w WHERE w.job_id=j.id),0) AS bytes
      FROM job_draft_inputs d JOIN jobs j ON j.id=d.job_id JOIN projects p ON p.id=d.project_id
      WHERE j.status IN (${terminalStatuses}) AND j.deletion_status='retained'
        AND j.lease_owner IS NULL
    ), ranked AS (
      SELECT *,
        ROW_NUMBER() OVER (PARTITION BY project_id,usable_pdf ORDER BY draft_version DESC,created_at DESC,id DESC) AS kind_generation
      FROM terminal_drafts
      WHERE project_deleted IS NULL AND error_code IS NOT 'DRAFT_SUPERSEDED' AND finished_at>?
    ), retained AS (
      SELECT *, ROW_NUMBER() OVER retention_order AS generation,
        SUM(bytes) OVER (retention_order ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_bytes
      FROM ranked
      WINDOW retention_order AS (PARTITION BY project_id ORDER BY
        (usable_pdf=1 AND kind_generation=1) DESC,draft_version DESC,created_at DESC,id DESC)
    ), eligible AS (
      SELECT id,finished_at FROM terminal_drafts
        WHERE project_deleted IS NOT NULL OR error_code='DRAFT_SUPERSEDED' OR finished_at<=?
      UNION ALL
      SELECT id,finished_at FROM retained
        WHERE NOT (usable_pdf=1 AND kind_generation=1)
          AND ((?>0 AND generation>?) OR (?>0 AND running_bytes>?))
    )
    UPDATE jobs SET deletion_status='pending',deletion_next_attempt_at=NULL
    WHERE id IN (
      SELECT e.id FROM eligible e
      WHERE NOT EXISTS (SELECT 1 FROM artifact_download_leases l WHERE l.job_id=e.id AND l.expires_at>?)
        AND NOT EXISTS (SELECT 1 FROM job_preview_requests q WHERE q.job_id=e.id AND q.status='running')
      ORDER BY e.finished_at,e.id LIMIT 100
    )
  `,
      )
      .run(
        draftCutoff,
        draftCutoff,
        draftGenerations,
        draftGenerations,
        draftProjectBytes,
        draftProjectBytes,
        now,
      ).changes,
  );
} catch (error) {
  recordFailure("draft-preview-gc", "draft-jobs", error);
}
const selectJobBatch = db.prepare(
  `SELECT j.id FROM jobs j WHERE (
    (j.deletion_status='retained' AND j.status IN (${terminalStatuses})
     AND COALESCE((SELECT p.pdf_completed_at FROM job_output_stages p WHERE p.job_id=j.id AND p.pdf_status='succeeded'),j.completed_at,j.updated_at)<=?)
    OR (j.status='deleting' AND j.deletion_status IN ('retained','pending','deleting'))
    OR (j.deletion_status IN ('pending','deleting','retry')
        AND (j.deletion_next_attempt_at IS NULL OR j.deletion_next_attempt_at<=?))
  ) AND j.lease_owner IS NULL AND NOT EXISTS
  (SELECT 1 FROM artifact_download_leases l WHERE l.job_id=j.id AND l.expires_at>?)
  AND NOT EXISTS (SELECT 1 FROM job_preview_requests p WHERE p.job_id=j.id AND p.status='running')
  ORDER BY COALESCE(j.deletion_next_attempt_at,j.completed_at,j.updated_at),j.id LIMIT ?`,
);
let jobsProcessed = 0;
let artifactsDeleted = 0;
for await (const record of cleanupCandidates(() =>
  selectJobBatch.all(cutoff, now, now, cleanupBatchSize),
)) {
  jobsProcessed += 1;
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
           AND COALESCE((SELECT p.pdf_completed_at FROM job_output_stages p WHERE p.job_id=jobs.id AND p.pdf_status='succeeded'),completed_at,updated_at)<=?)
          OR (status='deleting' AND deletion_status IN ('retained','pending','deleting'))
          OR (deletion_status IN ('pending','deleting','retry')
              AND (deletion_next_attempt_at IS NULL OR deletion_next_attempt_at<=?))
        ) AND lease_owner IS NULL AND NOT EXISTS
          (SELECT 1 FROM artifact_download_leases WHERE job_id=? AND expires_at>?)
          AND NOT EXISTS (SELECT 1 FROM job_preview_requests p WHERE p.job_id=jobs.id AND p.status='running')`,
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
      for (const child of [
        "output",
        "outputs",
        "work",
        "staging",
        "attempts",
        "preview-attempts",
      ])
        await rm(join(storageRoot, "jobs", id, child), {
          recursive: true,
          force: true,
        });
    } else
      await rm(join(storageRoot, "jobs", id), { recursive: true, force: true });
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM artifacts WHERE job_id=?").run(id);
    deleteDraftCacheAccounting.run(id);
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
      AND ${sourceReferenceCountSql("sources")}=0`,
      ).run(now, now, String(source.source_id));
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

let sourcesProcessed = 0;
let sourcesDeleted = 0;
for await (const record of cleanupCandidates(claimSourceBatch)) {
  sourcesProcessed += 1;
  const id = String(record.id),
    storageKey = String(record.storage_key);
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
       AND ${sourceReferenceCountSql("sources")}=0`,
      )
      .run(now, now, id);
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
    `SELECT j.id FROM jobs j WHERE j.status='deleted' AND j.lease_owner IS NULL
       AND (j.deleted_at<? OR EXISTS (SELECT 1 FROM job_draft_inputs d WHERE d.job_id=j.id))
       LIMIT 1000`,
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
const sourceHistoryCutoff = new Date(
  Date.now() - sourceHistoryDays * 86_400_000,
).toISOString();
let sourceHistoryDeleted = 0;
try {
  // Physical Source deletion can precede Job history expiry. Unlike file
  // collection, row collection checks even expired Job and deleted Project references.
  sourceHistoryDeleted = Number(
    db
      .prepare(
        `DELETE FROM sources WHERE id IN (
      SELECT s.id FROM sources s
      WHERE s.status='deleted' AND s.deletion_status='deleted' AND s.deleted_at<=?
        AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=s.id)
        AND NOT EXISTS (SELECT 1 FROM project_revisions WHERE source_id=s.id)
        AND NOT EXISTS (SELECT 1 FROM project_draft_files WHERE source_id=s.id)
        AND NOT EXISTS (SELECT 1 FROM job_draft_input_files WHERE source_id=s.id)
        AND NOT EXISTS (SELECT 1 FROM source_upload_nonces WHERE source_id=s.id)
        AND NOT EXISTS (SELECT 1 FROM source_refs WHERE source_id=s.id)
        AND NOT EXISTS (SELECT 1 FROM idempotency_records WHERE resource_id=s.id)
      ORDER BY s.deleted_at,s.id LIMIT 1000
    )`,
      )
      .run(sourceHistoryCutoff).changes,
  );
} catch (error) {
  recordFailure("source-history-delete", "bounded-batch", error);
}
let auditLogsDeleted = 0;
let auditSequenceEntriesDeleted = 0;
try {
  db.exec("BEGIN IMMEDIATE");
  const checkpoint = await readAuditCheckpoint(auditCheckpointPath);
  if (checkpoint.format === 3) {
    validateAuditCheckpoint(db, checkpoint);
    const auditCutoff = new Date(
      Date.now() - auditRetentionDays * 86_400_000,
    ).toISOString();
    auditLogsDeleted = Number(
      db
        .prepare(
          `DELETE FROM audit_logs WHERE id IN (
             SELECT a.id FROM audit_logs a JOIN audit_export_sequence e ON e.audit_id=a.id
             WHERE a.created_at<? AND e.sequence<=?
             ORDER BY e.sequence LIMIT ?
           )`,
        )
        .run(auditCutoff, BigInt(checkpoint.sequence), auditPruneBatchSize)
        .changes,
    );
    // Retain the one checkpoint anchor even after deleting its audit row. Its
    // random token detects a restored/forked DB that reused the same sequence.
    auditSequenceEntriesDeleted = Number(
      db
        .prepare(
          `DELETE FROM audit_export_sequence
      WHERE sequence IN (SELECT sequence FROM audit_export_sequence
        WHERE audit_id IS NULL AND sequence<? ORDER BY sequence LIMIT ?)`,
        )
        .run(BigInt(checkpoint.sequence), auditPruneBatchSize).changes,
    );
    // Classification outlives resource history, not the retained audit rows.
    // These index-covered lookups do not read/export or discard audit content.
    db.prepare(
      `DELETE FROM internal_resource_tombstones WHERE (kind,id) IN (
      SELECT t.kind,t.id FROM internal_resource_tombstones t
      WHERE NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.actor_type=t.kind AND a.actor_id=t.id)
        AND NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.target_type=t.kind AND a.target_id=t.id)
        AND (t.kind!='job' OR NOT EXISTS (SELECT 1 FROM audit_logs a WHERE a.target_type='render' AND a.target_id=t.id))
      ORDER BY t.kind,t.id LIMIT ?)`,
    ).run(auditPruneBatchSize);
  }
  db.exec("COMMIT");
} catch (error) {
  if (db.isTransaction) db.exec("ROLLBACK");
  auditLogsDeleted = 0;
  auditSequenceEntriesDeleted = 0;
  recordFailure("audit-prune", "audit_logs", error);
}
console.log(
  JSON.stringify({
    event: "cleanup.completed",
    result: itemFailureCount === 0 ? "success" : "partial",
    jobsProcessed,
    sourcesProcessed,
    budgetStopped,
    artifactsDeleted,
    draftPreviewsScheduled,
    sourcesDeleted,
    historyDeleted,
    sourceHistoryDeleted,
    auditLogsDeleted,
    auditSequenceEntriesDeleted,
    staleJobUploadsRecovered,
    staleSourceUploadsRecovered,
    itemFailureCount,
    itemFailures,
    remoteCodesDeleted,
    remoteLoginContinuationsDeleted,
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

async function* cleanupCandidates(loadBatch) {
  while (performance.now() < cleanupDeadline) {
    const batch = await loadBatch();
    yield* batch;
    if (batch.length < cleanupBatchSize) return;
  }
  budgetStopped = true;
}

async function claimSourceBatch() {
  try {
    return await claimUnprotectedSources(
      process.env.BACKUP_SOURCE_COORDINATION_DIR,
      (protectedIds) =>
        db
          .prepare(
            `UPDATE sources SET status='deleting',deletion_status='deleting',
           deletion_attempts=deletion_attempts+1,deletion_error=NULL,
           deletion_next_attempt_at=NULL,updated_at=?
         WHERE id IN (
           SELECT s.id FROM sources s WHERE (
             (deletion_status='retained' AND status IN ('ready','expired') AND expires_at<=?)
             OR (status='deleting' AND deletion_status IN ('retained','pending','deleting'))
             OR (deletion_status IN ('pending','deleting','retry')
                 AND (deletion_next_attempt_at IS NULL OR deletion_next_attempt_at<=?))
           ) AND ${sourceReferenceCountSql("s")}=0
             AND s.id NOT IN (SELECT value FROM json_each(?))
           ORDER BY COALESCE(deletion_next_attempt_at,expires_at,updated_at),id LIMIT ?
         ) RETURNING id,storage_key`,
          )
          .all(now, now, now, JSON.stringify(protectedIds), cleanupBatchSize),
    );
  } catch (error) {
    recordFailure("source-claim", "bounded-batch", error);
    return [];
  }
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
