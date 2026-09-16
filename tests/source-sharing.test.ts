import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import yazl from "yazl";
import type { AuthenticatedServiceAccount } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { createRendererApp } from "../apps/renderer-api/src/app.js";
import { RenderTicketsService } from "../apps/internal-api/src/services/render-tickets.js";
import { SourceTicketsService } from "../apps/internal-api/src/services/source-tickets.js";

const databases: RendererDatabase[] = [],
  roots: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("immutable shared Sources", () => {
  it.each([
    "reserved",
    "uploading",
    "queued",
    "running",
    "succeeded",
    "failed",
    "timeout",
    "canceled",
    "rejected",
    "deleting",
  ])(
    "keeps an orphan-expired Source reusable while a %s Job retains it",
    async (status) => {
      const { database, actor, sourceService, renderService } = await fixture();
      const input = { size: 1, sha256: "a".repeat(64) };
      const reserved = await sourceService.create(
        actor,
        input,
        "retained-job-source-123456",
      );
      const sourceId = reserved.value.sourceId;
      database.raw
        .prepare(
          "UPDATE sources SET status='ready',paths_json='[\"main.tex\"]' WHERE id=?",
        )
        .run(sourceId);
      const first = await renderService.create(
        actor,
        { sourceId, entrypoint: "main.tex" },
        "retained-first-job-123456",
      );
      database.raw
        .prepare("UPDATE jobs SET status=? WHERE id=?")
        .run(status, first.value.jobId);
      database.raw
        .prepare(
          "UPDATE sources SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
        )
        .run(sourceId);
      const now = new Date().toISOString();
      expect(database.sources.blockingReferenceCount(sourceId)).toBe(1);
      expect(
        database.sources.getOwnedReady(sourceId, actor.userId, now)?.id,
      ).toBe(sourceId);
      expect(database.sources.getReady(sourceId, now)?.id).toBe(sourceId);
      expect(
        database.sources.findReady(actor.userId, input.sha256, input.size, now)
          ?.id,
      ).toBe(sourceId);
      expect(
        database.sources.getOwnedReady(sourceId, "other-user", now),
      ).toBeUndefined();
      const second = await renderService.create(
        actor,
        { sourceId, entrypoint: "main.tex" },
        "retained-second-job-123456",
      );
      expect(database.jobs.get(second.value.jobId)?.source_id).toBe(sourceId);
      expect(database.sources.markDeleting(sourceId, now)).toBe(0);
    },
  );

  it.each(["project", "job"])(
    "replays %s-retained Source tickets without an expired idempotency row",
    async (kind) => {
      const { database, actor, sourceService, renderService } = await fixture();
      const input = { size: 1, sha256: "a".repeat(64) },
        now = new Date().toISOString();
      const {
        value: { sourceId },
      } = await sourceService.create(
        actor,
        input,
        "reuse-original-source-123456",
      );
      database.raw
        .prepare(
          "UPDATE sources SET status='ready',paths_json='[\"main.tex\"]' WHERE id=?",
        )
        .run(sourceId);
      if (kind === "project") {
        database.projects.insert({
          id: "project_retained",
          ownerUserId: actor.userId,
          displayName: "Retained",
          timestamp: now,
        });
        database.projects.insertRevision({
          id: "revision_retained",
          projectId: "project_retained",
          sourceId,
          displayName: "Retained",
          originalFilename: "main.tex",
          entrypoint: "main.tex",
          timestamp: now,
        });
      } else
        await renderService.create(
          actor,
          { sourceId, entrypoint: "main.tex" },
          "reuse-retaining-job-123456",
        );
      database.raw
        .prepare(
          "UPDATE sources SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",
        )
        .run(sourceId);
      const key = "reuse-retained-idempotency-123456";
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await sourceService.create(actor, input, key);
        expect(response.value).toMatchObject({
          sourceId,
          uploadRequired: false,
        });
      }
      const row = database.raw
        .prepare(
          "SELECT created_at,expires_at FROM idempotency_records WHERE key_hash=?",
        )
        .get(createHash("sha256").update(key).digest("hex"));
      expect(Date.parse(String(row?.expires_at))).toBeGreaterThan(
        Date.parse(now),
      );
      expect(
        Date.parse(String(row?.expires_at)) -
          Date.parse(String(row?.created_at)),
      ).toBe(86_400_000);
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 60_000);
      expect(
        (await sourceService.create(actor, input, key)).value.sourceId,
      ).toBe(sourceId);
      expect(
        database.raw
          .prepare(
            "SELECT created_at,expires_at FROM idempotency_records WHERE key_hash=?",
          )
          .get(createHash("sha256").update(key).digest("hex")),
      ).toEqual(row);
      // Replaying the original reservation after upload follows the same rule.
      expect(
        (
          await sourceService.create(
            actor,
            input,
            "reuse-original-source-123456",
          )
        ).value,
      ).toMatchObject({ sourceId, uploadRequired: false });
      await expect(
        sourceService.create(actor, { ...input, size: 2 }, key),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
      expect(
        database.raw.prepare("SELECT COUNT(*) AS n FROM sources").get()?.n,
      ).toBe(1);
      if (kind === "project")
        database.projects.softDelete(
          "project_retained",
          actor.userId,
          new Date().toISOString(),
        );
      else
        database.raw
          .prepare("UPDATE jobs SET status='deleted' WHERE source_id=?")
          .run(sourceId);
      await expect(
        sourceService.create(actor, input, key),
      ).rejects.toMatchObject({
        code: "IDEMPOTENT_RESOURCE_GONE",
        status: 410,
      });
      expect(
        database.raw.prepare("SELECT COUNT(*) AS n FROM sources").get()?.n,
      ).toBe(1);
    },
  );

  it("rechecks a deduplicated Source inside the idempotency write transaction", async () => {
    const { database, actor, sourceService } = await fixture();
    const input = { size: 1, sha256: "a".repeat(64) };
    const {
      value: { sourceId },
    } = await sourceService.create(actor, input, "race-source-original-123456");
    database.raw
      .prepare("UPDATE sources SET status='ready' WHERE id=?")
      .run(sourceId);
    const findReady = database.sources.findReady.bind(database.sources);
    const spy = vi
      .spyOn(database.sources, "findReady")
      .mockImplementationOnce((...args) => {
        const stale = findReady(...args);
        database.sources.markDeleting(sourceId, new Date().toISOString());
        return stale;
      });
    try {
      await expect(
        sourceService.create(actor, input, "race-source-reuse-123456"),
      ).rejects.toMatchObject({ code: "SOURCE_NOT_READY", status: 409 });
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS n FROM idempotency_records")
          .get()?.n,
      ).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("reuses an expired request key without depending on scheduled cleanup", async () => {
    const { database, actor, sourceService } = await fixture();
    const key = "expired-source-request-123456",
      input = { size: 1, sha256: "a".repeat(64) };
    await sourceService.create(actor, input, key);
    database.raw
      .prepare(
        "UPDATE idempotency_records SET expires_at='2000-01-01T00:00:00.000Z'",
      )
      .run();
    const response = await sourceService.create(actor, input, key);
    expect(response.status).toBe(201);
    expect(
      database.raw
        .prepare("SELECT COUNT(*) AS n FROM idempotency_records")
        .get()?.n,
    ).toBe(1);
  });

  it.each(["source", "legacy"] as const)(
    "releases claims and stops heartbeats after mkdir fails (%s)",
    async (kind) => {
      const {
        database,
        actor,
        tickets,
        sourceService,
        renderService,
        storageRoot,
      } = await fixture();
      const bytes = await zip([["main.tex", "test"]]);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      let path: string, token: string, id: string;
      if (kind === "source") {
        const reserved = await sourceService.create(
          actor,
          { size: bytes.length, sha256 },
          "failed-source-mkdir-123",
        );
        id = reserved.value.sourceId;
        if (!reserved.value.uploadTicket)
          throw new Error("Missing upload ticket");
        token = reserved.value.uploadTicket;
        path = `/api/v1/sources/${id}/content`;
      } else {
        const created = await renderService.create(
          actor,
          { size: bytes.length, sha256 },
          "failed-job-mkdir-12345",
        );
        if (!("uploadTicket" in created.value))
          throw new Error("Upload ticket missing");
        id = created.value.jobId;
        token = created.value.uploadTicket as string;
        database.raw
          .prepare("UPDATE jobs SET source_id=NULL WHERE id=?")
          .run(id);
        path = `/api/v1/jobs/${id}/source`;
      }
      await writeFile(
        join(storageRoot, kind === "source" ? "sources" : "jobs"),
        "not-a-directory",
      );
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const app = createRendererApp({
        database,
        tickets,
        storageRoot,
        maxUploadBytes: 20 * 1024 * 1024,
        minFreeStorageBytes: 1,
        artifactRetentionHours: 24,
      });
      const response = await app.request(path, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/zip",
          "Content-Length": String(bytes.length),
        },
        body: new Uint8Array(bytes).slice().buffer,
      });
      expect(response.status).toBe(500);
      expect(vi.getTimerCount()).toBe(0);
      const table = kind === "source" ? "source_upload_nonces" : "used_nonces";
      expect(
        database.raw
          .prepare(`SELECT state,claim_owner,claim_expires_at FROM ${table}`)
          .get(),
      ).toMatchObject({
        state: "released",
        claim_owner: null,
        claim_expires_at: null,
      });
      expect(
        kind === "source"
          ? database.sources.get(id)?.status
          : database.jobs.get(id)?.status,
      ).toBe("reserved");
    },
  );
  it("uploads one ZIP, validates entrypoints, deduplicates per owner, and queues independent jobs", async () => {
    const {
        database,
        actor,
        tickets,
        sourceService,
        renderService,
        storageRoot,
      } = await fixture(),
      bytes = await zip([
        ["a.tex", "a"],
        ["nested/b.tex", "b"],
      ]),
      sha256 = createHash("sha256").update(bytes).digest("hex");
    const reserved = await sourceService.create(
      actor,
      { size: bytes.length, sha256 },
      "source-reserve-1234567890",
    );
    expect(reserved.status).toBe(201);
    expect(reserved.value).toMatchObject({ uploadRequired: true });
    database.settings.upsert(
      "source_orphan_retention_minutes",
      5,
      "test",
      new Date().toISOString(),
    );
    const uploadStartedAt = Date.now(),
      app = createRendererApp({
        database,
        tickets,
        storageRoot,
        maxUploadBytes: 20 * 1024 * 1024,
        minFreeStorageBytes: 1,
        artifactRetentionHours: 24,
      });
    const upload = await app.request(
      `/api/v1/sources/${reserved.value.sourceId}/content`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${reserved.value.uploadTicket}`,
          "Content-Type": "application/zip",
          "Content-Length": String(bytes.length),
        },
        body: new Uint8Array(bytes).slice().buffer,
      },
    );
    expect(upload.status).toBe(204);
    const source = database.sources.get(reserved.value.sourceId);
    expect(source).toMatchObject({
      status: "ready",
      size: bytes.length,
      sha256,
    });
    expect(Date.parse(source?.expires_at ?? "")).toBeGreaterThanOrEqual(
      uploadStartedAt + 4 * 60_000,
    );
    expect(Date.parse(source?.expires_at ?? "")).toBeLessThanOrEqual(
      uploadStartedAt + 6 * 60_000,
    );
    expect(source && database.sources.paths(source)).toEqual([
      "a.tex",
      "nested/b.tex",
    ]);

    const first = await renderService.create(
        actor,
        { sourceId: reserved.value.sourceId, entrypoint: "a.tex" },
        "source-job-a-123456789",
      ),
      second = await renderService.create(
        actor,
        { sourceId: reserved.value.sourceId, entrypoint: "nested/b.tex" },
        "source-job-b-123456789",
      );
    expect(database.jobs.get(first.value.jobId)).toMatchObject({
      status: "queued",
      source_id: reserved.value.sourceId,
      entrypoint: "a.tex",
    });
    expect(database.jobs.get(second.value.jobId)).toMatchObject({
      status: "queued",
      source_id: reserved.value.sourceId,
      entrypoint: "nested/b.tex",
    });
    expect(database.jobs.storageUsageForUser(actor.userId)).toBe(
      bytes.length + 2,
    );
    await expect(
      renderService.create(
        actor,
        { sourceId: reserved.value.sourceId, entrypoint: "../a.tex" },
        "invalid-path-123456789",
      ),
    ).rejects.toMatchObject({ code: "ZIP_DOT_PATH" });

    const deduplicated = await sourceService.create(
      actor,
      { size: bytes.length, sha256 },
      "source-dedup-1234567890",
    );
    expect(deduplicated.value).toMatchObject({
      sourceId: reserved.value.sourceId,
      uploadRequired: false,
    });
    expect(
      (
        database.raw.prepare("SELECT COUNT(*) AS count FROM sources").get() as {
          count: number;
        }
      ).count,
    ).toBe(1);

    const otherActor: AuthenticatedServiceAccount = {
      ...actor,
      apiKeyId: "other-key",
      serviceAccountId: "other-service",
      userId: "other-user",
    };
    await expect(
      renderService.create(
        otherActor,
        { sourceId: reserved.value.sourceId, entrypoint: "a.tex" },
        "cross-owner-job-123456789",
      ),
    ).rejects.toMatchObject({ code: "SOURCE_NOT_READY", status: 409 });
    const otherReservation = await sourceService.create(
      otherActor,
      { size: bytes.length, sha256 },
      "cross-owner-source-123456",
    );
    expect(otherReservation.value).toMatchObject({ uploadRequired: true });
    expect(otherReservation.value.sourceId).not.toBe(reserved.value.sourceId);
  });

  it("keeps the legacy job-first upload contract while storing through Source", async () => {
    const { database, actor, tickets, renderService, storageRoot } =
        await fixture(),
      bytes = await zip([["main.tex", "ok"]]),
      sha256 = createHash("sha256").update(bytes).digest("hex"),
      created = await renderService.create(
        actor,
        { size: bytes.length, sha256 },
        "legacy-source-1234567890",
      );
    expect(created.value).toHaveProperty("uploadTicket");
    if (
      !("uploadTicket" in created.value) ||
      typeof created.value.uploadTicket !== "string"
    )
      throw new Error("Legacy upload ticket is missing");
    const app = createRendererApp({
        database,
        tickets,
        storageRoot,
        maxUploadBytes: 20 * 1024 * 1024,
        minFreeStorageBytes: 1,
        artifactRetentionHours: 24,
      }),
      response = await app.request(
        `/api/v1/jobs/${created.value.jobId}/source`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${created.value.uploadTicket}`,
            "Content-Type": "application/zip",
            "Content-Length": String(bytes.length),
          },
          body: new Uint8Array(bytes).slice().buffer,
        },
      );
    expect(response.status).toBe(204);
    expect(database.jobs.get(created.value.jobId)).toMatchObject({
      status: "queued",
      entrypoint: "main.tex",
    });
    expect(
      database.sources.get(
        database.jobs.get(created.value.jobId)?.source_id ?? "",
      ),
    ).toMatchObject({ status: "ready" });
  });
});

async function fixture() {
  const storageRoot = await mkdtemp(join(tmpdir(), "latex-source-test-"));
  roots.push(storageRoot);
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const timestamp = new Date().toISOString();
  database.raw
    .prepare(
      `INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('user','subject','user@example.test','User','user','active',1,'test',?,?)`,
    )
    .run(timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('service','user','Service','generic','active',1,?,?)`,
    )
    .run(timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key','service','Key','prefix','hash','v1','["render:create","render:read:own"]',?,'test')`,
    )
    .run(timestamp);
  database.raw
    .prepare(
      `INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('other-user','other-subject','other@example.test','Other','user','active',1,'test',?,?)`,
    )
    .run(timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('other-service','other-user','Other Service','generic','active',1,?,?)`,
    )
    .run(timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('other-key','other-service','Other Key','other-prefix','hash','v1','["render:create","render:read:own"]',?,'test')`,
    )
    .run(timestamp);
  const actor: AuthenticatedServiceAccount = {
      apiKeyId: "key",
      serviceAccountId: "service",
      userId: "user",
      userSecurityVersion: 1,
      serviceAccountSecurityVersion: 1,
      scopes: ["render:create", "render:read:own"],
      keyKind: "render",
    },
    tickets = new TicketService(
      database,
      "latex-renderer",
      "latex-render",
      { kid: "v1", secret: Buffer.alloc(32, 7) },
      [],
    ),
    deps = {
      database,
      apiKeys: {} as never,
      tickets,
      rendererPublicUrl: "https://latex.example.com",
      rendererVersion: "test",
      maxOutputBytes: 1,
      maxQueueLength: 20,
      maxUserStorageBytes: 20 * 1024 * 1024,
    };
  return {
    database,
    actor,
    tickets,
    storageRoot,
    sourceService: new SourceTicketsService(deps),
    renderService: new RenderTicketsService(deps),
  };
}

async function zip(
  entries: ReadonlyArray<readonly [name: string, value: string]>,
): Promise<Buffer> {
  const path = join(roots.at(-1) ?? tmpdir(), `source-${Math.random()}.zip`),
    archive = new yazl.ZipFile(),
    done = pipeline(archive.outputStream, createWriteStream(path));
  for (const [name, value] of entries)
    archive.addBuffer(Buffer.from(value), name);
  archive.end();
  await done;
  const { readFile } = await import("node:fs/promises");
  return readFile(path);
}
