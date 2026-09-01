import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { writeAuditCheckpoint } from "../deploy/scripts/audit-checkpoint.mjs";

const execFileAsync = promisify(execFile),
  roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("scheduled cleanup", () => {
  it("prunes only retained audit rows covered by the export checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-renderer-audit-prune-"));
    roots.push(root);
    const databasePath = join(root, "renderer.sqlite3"),
      storageRoot = join(root, "storage"),
      checkpointPath = join(root, "audit", "checkpoint"),
      old = "2020-01-01T00:00:00.000Z",
      recent = new Date().toISOString();
    const database = new RendererDatabase(databasePath);
    database.migrate();
    const insert = database.raw.prepare(
      `INSERT INTO audit_logs(
         id,actor_type,actor_id,action,target_type,target_id,result,
         metadata_json,created_at
       ) VALUES (?,'system','test','test.action','test','test','success','{}',?)`,
    );
    insert.run("audit_old", old);
    insert.run("audit_recent", recent);
    database.close();
    await writeAuditCheckpoint(checkpointPath, {
      createdAt: old,
      id: "audit_old",
    });

    const { stdout } = await execFileAsync(
      process.execPath,
      [join(process.cwd(), "deploy/scripts/cleanup.mjs")],
      {
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
          STORAGE_ROOT: storageRoot,
          AUDIT_EXPORT_CHECKPOINT: checkpointPath,
          AUDIT_LOG_RETENTION_DAYS: "365",
        },
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({ auditLogsDeleted: 1 });
    const verified = new RendererDatabase(databasePath);
    expect(
      verified.raw.prepare("SELECT id FROM audit_logs ORDER BY id").all(),
    ).toEqual([{ id: "audit_recent" }]);
    verified.close();
  });

  it("immediately removes jobs that were explicitly marked for deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-renderer-cleanup-"));
    roots.push(root);
    const databasePath = join(root, "renderer.sqlite3"),
      storageRoot = join(root, "storage"),
      jobId = "job_00000000000000000000000000000000",
      timestamp = new Date().toISOString();
    const db = new RendererDatabase(databasePath);
    db.migrate();
    db.raw
      .prepare(
        "INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('user_test','subject','owner@example.com','Owner','owner','active',1,'test',?,?)",
      )
      .run(timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('sa_test','user_test','test','ci','active',1,?,?)",
      )
      .run(timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key_test','sa_test','test','prefix','hash','v1','[]',?,'test')",
      )
      .run(timestamp);
    db.raw
      .prepare(
        "INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at,completed_at) VALUES (?,'user_test','sa_test','key_test','deleting','test',1,?,?,?,?)",
      )
      .run(jobId, "0".repeat(64), timestamp, timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO artifacts(id,job_id,type,relative_path,size,sha256,created_at) VALUES ('artifact_test',?,'preview','previews/page-1.png',1,?,?)",
      )
      .run(jobId, "0".repeat(64), timestamp);
    db.close();
    const preview = join(
      storageRoot,
      "jobs",
      jobId,
      "output",
      "previews",
      "page-1.png",
    );
    await mkdir(join(preview, ".."), { recursive: true });
    await writeFile(preview, "x");

    const { stdout } = await execFileAsync(
      process.execPath,
      [join(process.cwd(), "deploy/scripts/cleanup.mjs")],
      {
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
          STORAGE_ROOT: storageRoot,
        },
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      event: "cleanup.completed",
      artifactsDeleted: 1,
    });
    await expect(stat(join(storageRoot, "jobs", jobId))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const verified = new RendererDatabase(databasePath);
    expect(verified.jobs.get(jobId)?.status).toBe("deleted");
    expect(verified.jobs.get(jobId)?.deletion_status).toBe("deleted");
    expect(
      verified.raw
        .prepare("SELECT COUNT(*) AS count FROM artifacts WHERE job_id=?")
        .get(jobId),
    ).toMatchObject({ count: 0 });
    verified.close();
  });
  it("retains a shared Source until its final job is deleted", async () => {
    const root = await mkdtemp(
      join(tmpdir(), "latex-renderer-source-cleanup-"),
    );
    roots.push(root);
    const databasePath = join(root, "renderer.sqlite3"),
      storageRoot = join(root, "storage"),
      timestamp = new Date().toISOString(),
      sourceId = `source_${"a".repeat(32)}`,
      first = `job_${"a".repeat(32)}`,
      second = `job_${"b".repeat(32)}`;
    const db = new RendererDatabase(databasePath);
    db.migrate();
    db.raw
      .prepare(
        "INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('user','subject','u@example.test','U','owner','active',1,'test',?,?)",
      )
      .run(timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('sa','user','sa','ci','active',1,?,?)",
      )
      .run(timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key','sa','key','prefix','hash','v1','[]',?,'test')",
      )
      .run(timestamp);
    db.sources.insertReserved({
      id: sourceId,
      ownerUserId: "user",
      size: 1,
      sha256: "0".repeat(64),
      storageKey: `sources/${sourceId}/source.zip`,
      timestamp,
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    db.raw
      .prepare(
        "UPDATE sources SET status='ready',uploaded_at=?,paths_json='[\"main.tex\"]' WHERE id=?",
      )
      .run(timestamp, sourceId);
    for (const [id, status] of [
      [first, "deleting"],
      [second, "succeeded"],
    ] as const)
      db.raw
        .prepare(
          `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at,completed_at,source_id,entrypoint) VALUES (?,'user','sa','key',?,'test',1,?,?,?,?,?,'main.tex')`,
        )
        .run(
          id,
          status,
          "0".repeat(64),
          timestamp,
          timestamp,
          timestamp,
          sourceId,
        );
    db.close();
    const path = join(storageRoot, "sources", sourceId, "source.zip");
    await mkdir(join(storageRoot, "sources", sourceId), { recursive: true });
    await writeFile(path, "x");
    const run = () =>
      execFileAsync(
        process.execPath,
        [join(process.cwd(), "deploy/scripts/cleanup.mjs")],
        {
          env: {
            ...process.env,
            DATABASE_PATH: databasePath,
            STORAGE_ROOT: storageRoot,
          },
        },
      );
    await run();
    const retained = new RendererDatabase(databasePath);
    expect(retained.sources.get(sourceId)?.status).toBe("ready");
    retained.raw
      .prepare("UPDATE jobs SET status='deleting' WHERE id=?")
      .run(second);
    retained.close();
    await run();
    const cleaned = new RendererDatabase(databasePath);
    expect(cleaned.sources.get(sourceId)?.status).toBe("deleted");
    cleaned.close();
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("records a failed Job deletion without changing its render result or starving later Jobs", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-renderer-job-retry-"));
    roots.push(root);
    const databasePath = join(root, "renderer.sqlite3"),
      storageRoot = join(root, "storage"),
      failedId = `job_${"a".repeat(32)}`,
      deletedId = `job_${"b".repeat(32)}`,
      timestamp = "2026-01-01T00:00:00.000Z";
    const db = new RendererDatabase(databasePath);
    db.migrate();
    db.raw
      .prepare(
        "INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('user_retry','subject-retry','retry@example.test','Retry','owner','active',1,'test',?,?)",
      )
      .run(timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('sa_retry','user_retry','retry','ci','active',1,?,?)",
      )
      .run(timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key_retry','sa_retry','retry','retry-prefix','hash','v1','[]',?,'test')",
      )
      .run(timestamp);
    for (const id of [failedId, deletedId]) {
      db.raw
        .prepare(
          `INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,
           source_size,source_sha256,created_at,updated_at,completed_at)
           VALUES (?,'user_retry','sa_retry','key_retry','succeeded','test',1,?,?,?,?)`,
        )
        .run(id, "0".repeat(64), timestamp, timestamp, timestamp);
      expect(db.jobs.markDeleting(id, timestamp)).toBe(1);
      await mkdir(join(storageRoot, "jobs", id, "output"), {
        recursive: true,
      });
      await writeFile(
        join(storageRoot, "jobs", id, "output", "result.pdf"),
        "x",
      );
    }
    db.close();
    const failedRoot = join(storageRoot, "jobs", failedId);
    await chmod(failedRoot, 0o500);
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [join(process.cwd(), "deploy/scripts/cleanup.mjs")],
        {
          env: {
            ...process.env,
            DATABASE_PATH: databasePath,
            STORAGE_ROOT: storageRoot,
          },
        },
      );
      expect(JSON.parse(stdout)).toMatchObject({
        event: "cleanup.completed",
        result: "partial",
        artifactsDeleted: 1,
        itemFailureCount: 1,
      });
      const verified = new RendererDatabase(databasePath),
        failed = verified.jobs.get(failedId),
        deleted = verified.jobs.get(deletedId);
      expect(failed).toMatchObject({
        status: "succeeded",
        render_status: "succeeded",
        deletion_status: "retry",
        deletion_attempts: 1,
      });
      expect(failed?.deletion_error).toMatch(/permission denied/i);
      expect(failed?.deletion_next_attempt_at).not.toBeNull();
      expect(deleted).toMatchObject({
        status: "deleted",
        render_status: "succeeded",
        deletion_status: "deleted",
      });
    } finally {
      await chmod(failedRoot, 0o700).catch(() => undefined);
    }
  });

  it("continues Source cleanup after an unsafe permanent item error", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-renderer-source-retry-"));
    roots.push(root);
    const databasePath = join(root, "renderer.sqlite3"),
      storageRoot = join(root, "storage"),
      failedId = `source_${"a".repeat(32)}`,
      deletedId = `source_${"b".repeat(32)}`,
      timestamp = "2026-01-01T00:00:00.000Z";
    const db = new RendererDatabase(databasePath);
    db.migrate();
    db.raw
      .prepare(
        "INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('source_user','source-subject','source@example.test','Source','owner','active',1,'test',?,?)",
      )
      .run(timestamp, timestamp);
    for (const [id, storageKey] of [
      [failedId, "../outside-source.zip"],
      [deletedId, `sources/${deletedId}/source.zip`],
    ] as const) {
      db.sources.insertReserved({
        id,
        ownerUserId: "source_user",
        size: 1,
        sha256: "0".repeat(64),
        storageKey,
        timestamp,
        expiresAt: timestamp,
      });
      db.raw
        .prepare(
          "UPDATE sources SET status='expired',uploaded_at=?,paths_json='[\"main.tex\"]' WHERE id=?",
        )
        .run(timestamp, id);
    }
    db.close();
    const validPath = join(storageRoot, "sources", deletedId, "source.zip");
    await mkdir(join(validPath, ".."), { recursive: true });
    await writeFile(validPath, "x");

    const { stdout } = await execFileAsync(
      process.execPath,
      [join(process.cwd(), "deploy/scripts/cleanup.mjs")],
      {
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
          STORAGE_ROOT: storageRoot,
        },
      },
    );
    expect(JSON.parse(stdout)).toMatchObject({
      event: "cleanup.completed",
      result: "partial",
      sourcesDeleted: 1,
      itemFailureCount: 1,
    });
    const verified = new RendererDatabase(databasePath);
    expect(verified.sources.get(failedId)).toMatchObject({
      status: "expired",
      deletion_status: "retry",
      deletion_attempts: 1,
      deletion_error: "Unsafe source storage key",
    });
    expect(verified.sources.get(deletedId)).toMatchObject({
      status: "deleted",
      deletion_status: "deleted",
    });
    verified.raw
      .prepare(
        "UPDATE sources SET deletion_attempts=9,deletion_next_attempt_at=? WHERE id=?",
      )
      .run(timestamp, failedId);
    verified.close();
    await expect(stat(validPath)).rejects.toMatchObject({ code: "ENOENT" });

    const finalRun = await execFileAsync(
      process.execPath,
      [join(process.cwd(), "deploy/scripts/cleanup.mjs")],
      {
        env: {
          ...process.env,
          DATABASE_PATH: databasePath,
          STORAGE_ROOT: storageRoot,
        },
      },
    );
    expect(JSON.parse(finalRun.stdout)).toMatchObject({
      result: "partial",
      itemFailureCount: 1,
    });
    const permanent = new RendererDatabase(databasePath);
    expect(permanent.sources.get(failedId)).toMatchObject({
      status: "expired",
      deletion_status: "failed",
      deletion_attempts: 10,
      deletion_next_attempt_at: null,
    });
    permanent.close();
  });

  it("recovers crashed upload claims while preserving a live upload lease", async () => {
    const root = await mkdtemp(join(tmpdir(), "latex-renderer-upload-lease-"));
    roots.push(root);
    const databasePath = join(root, "renderer.sqlite3"),
      storageRoot = join(root, "storage"),
      timestamp = new Date().toISOString(),
      future = new Date(Date.now() + 600_000).toISOString(),
      past = new Date(Date.now() - 60_000).toISOString(),
      jobId = `job_${"7".repeat(32)}`,
      jobSourceId = `source_${"7".repeat(32)}`,
      activeSourceId = `source_${"8".repeat(32)}`;
    const db = new RendererDatabase(databasePath);
    db.migrate();
    db.raw
      .prepare(
        "INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('upload_user','upload-subject','upload@example.test','Upload','owner','active',1,'test',?,?)",
      )
      .run(timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('upload_sa','upload_user','upload','ci','active',1,?,?)",
      )
      .run(timestamp, timestamp);
    db.raw
      .prepare(
        "INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('upload_key','upload_sa','upload','upload-prefix','hash','v1','[]',?,'test')",
      )
      .run(timestamp);
    for (const [id, expiresAt] of [
      [jobSourceId, future],
      [activeSourceId, past],
    ] as const)
      db.sources.insertReserved({
        id,
        ownerUserId: "upload_user",
        size: 1,
        sha256: "0".repeat(64),
        storageKey: `sources/${id}/source.zip`,
        timestamp,
        expiresAt,
      });
    db.jobs.insertReserved({
      id: jobId,
      userId: "upload_user",
      serviceAccountId: "upload_sa",
      apiKeyId: "upload_key",
      rendererVersion: "test",
      sourceSize: 1,
      sourceSha256: "0".repeat(64),
      sourceId: jobSourceId,
      timestamp,
      reservedOutputBytes: 1,
    });
    db.security.insertNonce("job-upload-nonce", jobId, future);
    db.security.insertSourceNonce(
      "source-upload-nonce",
      activeSourceId,
      future,
    );
    db.claimNonce("job-upload-nonce", jobId, "crashed-owner", future);
    db.claimSourceNonce(
      "source-upload-nonce",
      activeSourceId,
      "live-owner",
      future,
    );
    db.transitionJob(jobId, ["reserved"], "uploading");
    db.sources.transition(jobSourceId, ["reserved"], "uploading", timestamp);
    db.sources.transition(activeSourceId, ["reserved"], "uploading", timestamp);
    db.raw
      .prepare(
        "UPDATE used_nonces SET claim_expires_at=? WHERE nonce='job-upload-nonce'",
      )
      .run(past);
    db.close();

    const run = () =>
      execFileAsync(
        process.execPath,
        [join(process.cwd(), "deploy/scripts/cleanup.mjs")],
        {
          env: {
            ...process.env,
            DATABASE_PATH: databasePath,
            STORAGE_ROOT: storageRoot,
          },
        },
      );
    const first = JSON.parse((await run()).stdout) as Record<string, unknown>;
    expect(first).toMatchObject({
      staleJobUploadsRecovered: 1,
      staleSourceUploadsRecovered: 0,
    });
    const recovered = new RendererDatabase(databasePath);
    expect(recovered.jobs.get(jobId)?.status).toBe("reserved");
    expect(recovered.sources.get(jobSourceId)?.status).toBe("reserved");
    expect(recovered.sources.get(activeSourceId)?.status).toBe("uploading");
    expect(
      recovered.raw
        .prepare(
          "SELECT state,expires_at,claim_expires_at FROM used_nonces WHERE nonce='job-upload-nonce'",
        )
        .get(),
    ).toEqual({
      state: "released",
      expires_at: future,
      claim_expires_at: null,
    });
    recovered.raw
      .prepare(
        "UPDATE source_upload_nonces SET claim_expires_at=? WHERE nonce='source-upload-nonce'",
      )
      .run(past);
    recovered.close();

    const second = JSON.parse((await run()).stdout) as Record<string, unknown>;
    expect(second).toMatchObject({
      staleJobUploadsRecovered: 0,
      staleSourceUploadsRecovered: 1,
      sourcesDeleted: 1,
    });
    const expired = new RendererDatabase(databasePath);
    expect(expired.sources.get(activeSourceId)?.status).toBe("deleted");
    expired.close();
  });
});
