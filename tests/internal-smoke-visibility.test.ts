import { readFileSync } from "node:fs";
import { afterEach, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { internalSmokeVisibilitySql } from "../packages/database/src/schema.js";
import { SourceTicketsService } from "../apps/internal-api/src/services/source-tickets.js";
import { RenderTicketsService } from "../apps/internal-api/src/services/render-tickets.js";
import { TicketService } from "@latex-renderer/ticket";
import type { AuthenticatedServiceAccount } from "@latex-renderer/auth";

const databases: RendererDatabase[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
const timestamp = "2026-10-01T00:00:00.000Z";
const migration = readFileSync(
  new URL(
    "../deploy/migrations/019_internal_smoke_visibility.sql",
    import.meta.url,
  ),
  "utf8",
);

function fixture() {
  const db = new RendererDatabase(":memory:");
  databases.push(db);
  db.migrate();
  db.raw
    .exec(`INSERT INTO users(id,email,display_name,role,created_by,created_at,updated_at)
    VALUES ('user_owner','owner@example.invalid','Owner','owner','test','${timestamp}','${timestamp}');`);
  for (const [id, creator] of [
    ["sa_smoke", "local-smoke-test"],
    ["sa_user", "test"],
  ] as const) {
    db.raw
      .prepare(
        `INSERT INTO service_accounts(id,owner_user_id,name,client_type,created_at,updated_at)
      VALUES (?,'user_owner',?,'ci',?,?)`,
      )
      .run(id, `production-smoke-${id}`, timestamp, timestamp);
    db.raw
      .prepare(
        `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
      VALUES (?,?,'production-smoke',?,'hash','v1','["render:create","render:read:own"]',?,?)`,
      )
      .run(`key_${id}`, id, `prefix_${id}`, timestamp, creator);
  }
  return db;
}

it("uses identical runtime and standalone migration SQL", () => {
  const withoutComments = (value: string) =>
    value
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .replace(/\s+/g, " ")
      .trim();
  expect(withoutComments(migration)).toBe(
    withoutComments(`BEGIN IMMEDIATE; ${internalSmokeVisibilitySql} COMMIT;`),
  );
});

it.each(["runtime", "standalone"])(
  "migrates proven legacy smoke only and preserves shared input (%s)",
  (mode) => {
    const db = fixture();
    const addSource = (id: string) =>
      db.sources.insertReserved({
        id,
        ownerUserId: "user_owner",
        size: 2,
        sha256: "f".repeat(64),
        storageKey: id,
        timestamp,
        expiresAt: "2099-01-01",
      });
    const addJob = (id: string, sourceId: string, serviceAccountId: string) =>
      db.jobs.insertReserved({
        id,
        userId: "user_owner",
        serviceAccountId,
        apiKeyId: `key_${serviceAccountId}`,
        rendererVersion: "test",
        sourceSize: 2,
        sourceSha256: "f".repeat(64),
        sourceId,
        timestamp,
        reservedOutputBytes: 0,
      });
    for (const id of [
      "source_exclusive",
      "source_shared",
      "source_project",
      "source_orphan",
    ])
      addSource(id);
    addJob("job_internal", "source_exclusive", "sa_smoke");
    addJob("job_shared_smoke", "source_shared", "sa_smoke");
    addJob("job_shared_user", "source_shared", "sa_user");
    addJob("job_project_smoke", "source_project", "sa_smoke");
    db.raw
      .exec(`INSERT INTO projects(id,owner_user_id,display_name,created_at,updated_at)
    VALUES ('project_test','user_owner','Test','${timestamp}','${timestamp}');
    INSERT INTO project_revisions(id,project_id,source_id,revision_number,display_name,original_filename,entrypoint,created_at)
    VALUES ('revision_test','project_test','source_project',1,'Test','main.tex','main.tex','${timestamp}');`);
    db.audit({
      actorType: "service_account",
      actorId: "sa_smoke",
      action: "source.reserved",
      targetType: "source",
      targetId: "source_orphan",
      result: "success",
    });
    db.raw
      .exec(`DROP INDEX idx_service_accounts_purpose; DROP INDEX idx_sources_purpose;
    ALTER TABLE service_accounts DROP COLUMN purpose; ALTER TABLE sources DROP COLUMN purpose;
    DELETE FROM schema_migrations WHERE version=19;`);
    if (mode === "runtime") db.migrate();
    else db.raw.exec(migration);
    db.migrate();
    expect(db.serviceAccounts.list().map((row) => row.id)).toEqual(["sa_user"]);
    expect(db.apiKeys.list().map((row) => row.id)).toEqual(["key_sa_user"]);
    expect(db.jobs.list().map((row) => row.id)).toEqual(["job_shared_user"]);
    expect(db.sources.getVisible("source_exclusive")).toBeUndefined();
    expect(db.sources.getVisible("source_orphan")).toBeUndefined();
    expect(db.sources.getVisible("source_shared")).toBeDefined();
    expect(db.sources.getVisible("source_project")).toBeDefined();
    expect(
      db.sources.listPage().items.find((row) => row.id === "source_shared"),
    ).toMatchObject({ job_count: 1, latest_job_id: "job_shared_user" });
    expect(db.raw.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.raw.prepare("PRAGMA integrity_check").get()).toEqual({
      integrity_check: "ok",
    });
  },
);

it("isolates Source deduplication and allows smoke's own source/render ticket lifecycle", async () => {
  const database = fixture();
  database.raw.exec(
    "UPDATE service_accounts SET purpose='production-smoke' WHERE id='sa_smoke'",
  );
  const actor: AuthenticatedServiceAccount = {
    userId: "user_owner",
    serviceAccountId: "sa_smoke",
    apiKeyId: "key_sa_smoke",
    userSecurityVersion: 1,
    serviceAccountSecurityVersion: 1,
    scopes: ["render:create", "render:read:own"],
    keyKind: "render",
  };
  const deps = {
    database,
    apiKeys: {} as never,
    tickets: new TicketService(
      database,
      "latex-renderer",
      "latex-render",
      { kid: "v1", secret: Buffer.alloc(32, 9) },
      [],
    ),
    rendererPublicUrl: "https://renderer.example.invalid",
    rendererVersion: "test",
    maxUploadBytes: 1024,
    maxOutputBytes: 10,
    maxQueueLength: 10,
    maxUserStorageBytes: 4096,
  };
  const sources = new SourceTicketsService(deps),
    renders = new RenderTicketsService(deps),
    input = { size: 2, sha256: "f".repeat(64) };
  const created = await sources.create(actor, input, "smoke-source-123456789");
  const id = created.value.sourceId;
  expect(database.sources.getVisible(id)).toBeUndefined();
  expect(
    (await sources.create(actor, input, "smoke-source-123456789")).value
      .sourceId,
  ).toBe(id);
  database.raw
    .prepare(
      "UPDATE sources SET status='ready',paths_json='[\"main.tex\"]' WHERE id=?",
    )
    .run(id);
  expect(
    database.sources.findReady(
      actor.userId,
      input.sha256,
      input.size,
      timestamp,
    ),
  ).toBeUndefined();
  expect(database.sources.getOwned(id, actor.userId)).toBeUndefined();
  const reused = await sources.create(actor, input, "smoke-dedupe-123456789");
  expect(reused.value).toMatchObject({ sourceId: id, uploadRequired: false });
  const render = await renders.create(
    actor,
    { sourceId: id, entrypoint: "main.tex", outputs: ["pdf"] },
    "smoke-render-123456789",
  );
  expect(database.jobs.get(render.value.jobId)).toBeDefined();
  expect(database.jobs.getVisible(render.value.jobId)).toBeUndefined();
  expect(
    database.jobs.getOwned(
      render.value.jobId,
      actor.userId,
      actor.serviceAccountId,
    ),
  ).toBeDefined();
  expect(
    (
      await renders.create(
        actor,
        { sourceId: id, entrypoint: "main.tex", outputs: ["pdf"] },
        "smoke-render-123456789",
      )
    ).value.jobId,
  ).toBe(render.value.jobId);
  const ordinary = {
    ...actor,
    serviceAccountId: "sa_user",
    apiKeyId: "key_sa_user",
  };
  await expect(
    renders.create(
      ordinary,
      { sourceId: id, entrypoint: "main.tex", outputs: ["pdf"] },
      "ordinary-render-123456789",
    ),
  ).rejects.toMatchObject({ code: "SOURCE_NOT_READY" });
});
