import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";

const execFileAsync = promisify(execFile),
  roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("scheduled cleanup", () => {
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
});
