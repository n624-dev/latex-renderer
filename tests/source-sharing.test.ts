import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { afterEach, describe, expect, it } from "vitest";
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
  for (const db of databases.splice(0)) db.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("immutable shared Sources", () => {
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
    expect(database.jobs.storageUsageForUser(actor.userId)).toBe(bytes.length);
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
