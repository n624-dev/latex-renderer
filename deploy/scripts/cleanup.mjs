#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const databasePath = required("DATABASE_PATH");
const storageRoot = required("STORAGE_ROOT");
const artifactHours = positive("ARTIFACT_RETENTION_HOURS", 24);
const historyDays = positive("JOB_HISTORY_RETENTION_DAYS", 30);
const db = new DatabaseSync(databasePath, {
  enableForeignKeyConstraints: true,
});
db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON");

const now = new Date().toISOString();
const reservationCutoff = new Date(
  Date.now() - positive("UPLOAD_RESERVATION_MINUTES", 30) * 60_000,
).toISOString();
db.prepare(
  `UPDATE jobs SET status='expired',completed_at=?,updated_at=?,error_code='UPLOAD_EXPIRED'
  WHERE status IN ('reserved','uploading') AND updated_at<?`,
).run(now, now, reservationCutoff);
db.prepare(
  `UPDATE used_nonces SET state='expired',claim_owner=NULL WHERE expires_at<? AND state IN ('unused','claimed','released')`,
).run(now);
db.prepare(
  `UPDATE sources SET status='expired',updated_at=? WHERE status IN ('reserved','uploading') AND expires_at<?`,
).run(now, now);
db.prepare(
  `UPDATE source_upload_nonces SET state='expired',claim_owner=NULL WHERE expires_at<? AND state IN ('unused','claimed','released')`,
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
const jobs = db
  .prepare(
    `SELECT j.id FROM jobs j WHERE
  ((j.status IN ('succeeded','failed','timeout','canceled','rejected','expired') AND COALESCE(j.completed_at,j.updated_at)<?)
    OR j.status='deleting') AND NOT EXISTS
  (SELECT 1 FROM artifact_download_leases l WHERE l.job_id=j.id AND l.expires_at>?) LIMIT 100`,
  )
  .all(cutoff, now);
let artifactsDeleted = 0;
for (const record of jobs) {
  const id = String(record.id);
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db
      .prepare(
        `UPDATE jobs SET status='deleting',updated_at=? WHERE id=?
      AND status IN ('succeeded','failed','timeout','canceled','rejected','expired','deleting')
      AND NOT EXISTS (SELECT 1 FROM artifact_download_leases WHERE job_id=? AND expires_at>?)`,
      )
      .run(now, id, id, now);
    db.exec("COMMIT");
    if (changed.changes !== 1) continue;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  try {
    const sourceStorage = db
      .prepare(
        `SELECT s.storage_key FROM jobs j LEFT JOIN sources s ON s.id=j.source_id WHERE j.id=?`,
      )
      .get(id)?.storage_key;
    if (sourceStorage === `jobs/${id}/input/source.zip`) {
      for (const child of ["output", "work", "staging"])
        await rm(join(storageRoot, "jobs", id, child), {
          recursive: true,
          force: true,
        });
    } else
      await rm(join(storageRoot, "jobs", id), { recursive: true, force: true });
    db.exec("BEGIN IMMEDIATE");
    db.prepare("DELETE FROM artifacts WHERE job_id=?").run(id);
    const source = db.prepare("SELECT source_id FROM jobs WHERE id=?").get(id);
    db.prepare(
      "UPDATE jobs SET status='deleted',deleted_at=?,updated_at=? WHERE id=? AND status='deleting'",
    ).run(now, now, id);
    if (source?.source_id)
      db.prepare(
        `UPDATE sources SET expires_at=?,updated_at=? WHERE id=? AND status='ready'
      AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=? AND status NOT IN ('deleted','expired'))`,
      ).run(now, now, String(source.source_id), String(source.source_id));
    db.exec("COMMIT");
    artifactsDeleted += 1;
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    db.prepare(
      "UPDATE jobs SET status='failed',error_code='CLEANUP_FAILED',updated_at=? WHERE id=? AND status='deleting'",
    ).run(now, id);
    throw error;
  }
}

const sources = db
  .prepare(
    `SELECT id,storage_key FROM sources s WHERE status IN ('ready','expired','deleting') AND (status='deleting' OR expires_at<=?)
  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.source_id=s.id AND j.status NOT IN ('deleted','expired'))
  AND NOT EXISTS (SELECT 1 FROM project_revisions r JOIN projects p ON p.id=r.project_id
                  WHERE r.source_id=s.id AND p.deleted_at IS NULL) LIMIT 100`,
  )
  .all(now);
let sourcesDeleted = 0;
for (const record of sources) {
  const id = String(record.id),
    storageKey = String(record.storage_key);
  db.exec("BEGIN IMMEDIATE");
  try {
    const changed = db
      .prepare(
        `UPDATE sources SET status='deleting',updated_at=? WHERE id=? AND status IN ('ready','expired','deleting')
    AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=? AND status NOT IN ('deleted','expired'))
    AND NOT EXISTS (SELECT 1 FROM project_revisions r JOIN projects p ON p.id=r.project_id
                    WHERE r.source_id=? AND p.deleted_at IS NULL)`,
      )
      .run(now, id, id, id);
    db.exec("COMMIT");
    if (changed.changes !== 1) continue;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
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
    db.prepare(
      `UPDATE sources SET status='deleted',deleted_at=?,updated_at=? WHERE id=? AND status='deleting'
       AND NOT EXISTS (SELECT 1 FROM jobs WHERE source_id=? AND status NOT IN ('deleted','expired'))
       AND NOT EXISTS (SELECT 1 FROM project_revisions r JOIN projects p ON p.id=r.project_id
                       WHERE r.source_id=? AND p.deleted_at IS NULL)`,
    ).run(now, now, id, id, id);
    sourcesDeleted += 1;
  } catch (error) {
    db.prepare(
      "UPDATE sources SET status='expired',updated_at=? WHERE id=? AND status='deleting'",
    ).run(now, id);
    throw error;
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
db.exec("BEGIN IMMEDIATE");
try {
  for (const id of old) {
    db.prepare(
      "UPDATE jobs SET retry_of_job_id=NULL WHERE retry_of_job_id=?",
    ).run(id);
    db.prepare("DELETE FROM used_nonces WHERE job_id=?").run(id);
    db.prepare("DELETE FROM jobs WHERE id=? AND status='deleted'").run(id);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
console.log(
  JSON.stringify({
    event: "cleanup.completed",
    artifactsDeleted,
    sourcesDeleted,
    historyDeleted: old.length,
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
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive integer`);
  return value;
}
