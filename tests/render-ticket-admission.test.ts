import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthenticatedServiceAccount } from "@latex-renderer/auth";
import { ApiKeyService } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { createInternalApp } from "../apps/internal-api/src/app.js";
import { RenderTicketsService } from "../apps/internal-api/src/services/render-tickets.js";

const databases: RendererDatabase[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("render ticket admission", () => {
  it.each(["legacy", "source"] as const)(
    "keeps %s Job renewal and replay bound to its original API key over HTTP",
    async (mode) => {
      const f = fixture({ maxStorage: 100, maxQueue: 20 }),
        { database, tickets, apiKeys, app } = f,
        keyA = insertKey(f, "service"),
        keyB = insertKey(f, "service"),
        timestamp = new Date().toISOString();
      database.serviceAccounts.insert({
        id: "other_service",
        ownerUserId: "user",
        name: "Other service",
        clientType: "generic",
        timestamp,
      });
      const otherKey = insertKey(f, "other_service"),
        body =
          mode === "legacy"
            ? { size: 1, sha256: "b".repeat(64) }
            : { sourceId: readySource(database) },
        request = (token: string, path: string, replayKey?: string) =>
          app.request(`/internal/v1/${path}`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              ...(replayKey === undefined
                ? {}
                : {
                    "Content-Type": "application/json",
                    "Idempotency-Key": replayKey,
                  }),
            },
            ...(replayKey === undefined ? {} : { body: JSON.stringify(body) }),
          }),
        key = `original-${mode}-123456789`,
        created = await request(keyA.token, "render-tickets", key);
      expect(created.status).toBe(201);
      const original = (await created.json()) as {
        jobId: string;
        jobTicket: string;
      };
      await expect(
        tickets.verify(original.jobTicket, "status", original.jobId),
      ).resolves.toMatchObject({ api_key_id: keyA.id });

      for (const denied of [keyB, otherKey]) {
        for (const response of [
          await request(denied.token, `jobs/${original.jobId}/ticket`),
          // Same-Service-Account idempotency replay must not mint an unusable ticket.
          ...(denied === keyB
            ? [await request(denied.token, "render-tickets", key)]
            : []),
        ]) {
          expect(response.status).toBe(404);
          expect(await response.json()).toEqual({
            error: { code: "JOB_NOT_FOUND", message: "Job does not exist" },
          });
        }
      }
      const mismatched = await tickets.issueJob({
        jobId: original.jobId,
        userId: "user",
        serviceAccountId: "service",
        apiKeyId: keyB.id,
        userSecurityVersion: 1,
        serviceAccountSecurityVersion: 1,
      });
      await expect(
        tickets.verify(mismatched, "status", original.jobId),
      ).rejects.toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });

      for (const response of [
        await request(keyA.token, `jobs/${original.jobId}/ticket`),
        await request(keyA.token, "render-tickets", key),
      ]) {
        expect(response.status).toBe(200);
        const renewed = (await response.json()) as { jobTicket: string };
        await expect(
          tickets.verify(renewed.jobTicket, "status", original.jobId),
        ).resolves.toMatchObject({ api_key_id: keyA.id });
      }
      // Source sharing is unchanged: B can create its own Job with a new key.
      const own = await request(keyB.token, "render-tickets", `new-${key}`);
      expect(own.status).toBe(201);
      const owned = (await own.json()) as { jobId: string; jobTicket: string };
      expect(owned.jobId).not.toBe(original.jobId);
      await expect(
        tickets.verify(owned.jobTicket, "status", owned.jobId),
      ).resolves.toMatchObject({ api_key_id: keyB.id });
      expect(
        (await request(keyB.token, `jobs/${owned.jobId}/ticket`)).status,
      ).toBe(200);

      database.raw
        .prepare("UPDATE api_keys SET revoked_at=? WHERE id=?")
        .run(timestamp, keyA.id);
      expect(() => apiKeys.authenticate(keyA.token)).toThrow(/revoked/);
      expect(
        (await request(keyA.token, `jobs/${original.jobId}/ticket`)).status,
      ).toBe(401);
      expect((await request(keyA.token, "render-tickets", key)).status).toBe(
        401,
      );
      await expect(
        tickets.verify(original.jobTicket, "status", original.jobId),
      ).rejects.toMatchObject({ code: "TICKET_SUBJECT_INACTIVE", status: 401 });
      expect(
        (await request(keyB.token, `jobs/${original.jobId}/ticket`)).status,
      ).toBe(404);
      expect(database.jobs.countActive()).toBe(2);
    },
  );

  it("rejects another key's SVG retry before mutating stages, audit or idempotency", async () => {
    const f = fixture({ maxStorage: 100, maxQueue: 20 }),
      { database, service, tickets, actor } = f,
      keyB = insertKey(f, actor.serviceAccountId),
      actorB = f.apiKeys.authenticate(keyB.token),
      created = await service.create(
        actor,
        { sourceId: readySource(database), outputs: ["pdf", "svg"] },
        "svg-original-123456789",
      ),
      jobId = created.value.jobId,
      timestamp = new Date().toISOString();
    database.worker.claimNext("worker", timestamp, "2099-01-01T00:00:00.000Z");
    expect(
      database.outputStages.initialize(jobId, "worker", 1, "fixture"),
    ).toBe(true);
    database.worker.transitionOwned(
      jobId,
      "worker",
      1,
      ["validating"],
      "running",
      timestamp,
    );
    expect(database.outputStages.start(jobId, "pdf", "worker", 1)).toBe(true);
    expect(
      database.outputStages.completePdf(jobId, "worker", 1, {
        storageGeneration: 1,
        sha256: "a".repeat(64),
        synctexSha256: "c".repeat(64),
        synctexBytes: 1,
        completedAt: timestamp,
      }),
    ).toBe(true);
    database.artifacts.insert({
      id: "artifact_pdf",
      job_id: jobId,
      type: "pdf",
      relative_path: "result.pdf",
      storage_generation: 1,
      size: 1,
      sha256: "a".repeat(64),
      created_at: timestamp,
    });
    database.worker.transitionOwned(
      jobId,
      "worker",
      1,
      ["running"],
      "failed",
      timestamp,
      {
        completed_at: timestamp,
        lease_owner: null,
        lease_expires_at: null,
        output_size: 1,
      },
    );
    const snapshot = () => ({
        job: database.jobs.getOwned(
          jobId,
          actor.userId,
          actor.serviceAccountId,
        ),
        stages: database.outputStages.checkpoint(jobId),
        audit: database.raw
          .prepare("SELECT * FROM audit_logs ORDER BY id")
          .all(),
        idempotency: database.raw
          .prepare("SELECT * FROM idempotency_records ORDER BY key_hash")
          .all(),
      }),
      before = snapshot(),
      retryKey = "svg-retry-123456789";
    await expect(
      service.create(actorB, { retrySvgJobId: jobId }, retryKey),
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });
    expect(snapshot()).toEqual(before);
    const first = await service.create(
      actor,
      { retrySvgJobId: jobId },
      retryKey,
    );
    expect(first.status).toBe(202);
    await expect(
      tickets.verify(first.value.jobTicket, "status", jobId),
    ).resolves.toMatchObject({ api_key_id: actor.apiKeyId });
    const queued = snapshot();
    await expect(
      service.create(actorB, { retrySvgJobId: jobId }, retryKey),
    ).rejects.toMatchObject({ code: "JOB_NOT_FOUND", status: 404 });
    expect(snapshot()).toEqual(queued);
    expect(
      (await service.create(actor, { retrySvgJobId: jobId }, retryKey)).status,
    ).toBe(200);
    expect(database.outputStages.publicState(jobId)?.svg).toMatchObject({
      status: "queued",
      attempt: 2,
    });
  });

  it("rejects a request that would cross the user storage boundary", async () => {
    const { database, service, actor } = fixture({
      maxStorage: 10,
      maxQueue: 10,
    });
    database.jobs.insertReserved({
      id: "job_00000000000000000000000000000000",
      userId: actor.userId,
      serviceAccountId: actor.serviceAccountId,
      apiKeyId: actor.apiKeyId,
      rendererVersion: "test",
      sourceSize: 8,
      sourceSha256: "0".repeat(64),
      timestamp: new Date().toISOString(),
      reservedOutputBytes: 0,
    });
    await expect(
      service.create(
        actor,
        { size: 3, sha256: "a".repeat(64) },
        "quota-boundary-123456",
      ),
    ).rejects.toMatchObject({ code: "USER_STORAGE_QUOTA", status: 429 });
  });

  it("replays only a still-usable upload reservation and never mints a replacement nonce", async () => {
    const { database, service, actor, tickets } = fixture({
      maxStorage: 100,
      maxQueue: 1,
    });
    const first = await service.create(
      actor,
      { size: 1, sha256: "b".repeat(64) },
      "idempotent-render-123456",
    );
    const repeated = await service.create(
      actor,
      { size: 1, sha256: "b".repeat(64), outputs: ["pdf"] },
      "idempotent-render-123456",
    );
    expect(repeated.status).toBe(200);
    expect(repeated.value.jobId).toBe(first.value.jobId);
    if (
      !("uploadTicket" in repeated.value) ||
      typeof repeated.value.uploadTicket !== "string"
    )
      throw new Error("Legacy upload ticket is missing");
    await expect(
      tickets.verify(repeated.value.uploadTicket, "upload", first.value.jobId),
    ).resolves.toMatchObject({
      nonce: database.security.latestUsableNonce(
        first.value.jobId,
        new Date().toISOString(),
      ),
    });

    database.raw
      .prepare(
        "UPDATE used_nonces SET state='consumed',expires_at=? WHERE job_id=?",
      )
      .run(new Date(Date.now() - 1_000).toISOString(), first.value.jobId);
    await expect(
      service.create(
        actor,
        { size: 1, sha256: "b".repeat(64) },
        "idempotent-render-123456",
      ),
    ).rejects.toMatchObject({
      code: "IDEMPOTENT_RESOURCE_GONE",
      status: 410,
    });
    expect(
      (
        database.raw
          .prepare("SELECT COUNT(*) AS count FROM used_nonces WHERE job_id=?")
          .get(first.value.jobId) as { count: number }
      ).count,
    ).toBe(1);
  });

  it("atomically enforces the global queue limit across database connections", async () => {
    const {
      services,
      actor,
      databases: connections,
    } = await concurrentFixture({
      maxStorage: 100,
      maxQueue: 1,
    });
    const results = await Promise.allSettled(
      services.map((service, index) =>
        service.create(
          actor,
          { size: 1, sha256: String(index + 1).repeat(64) },
          `concurrent-global-${index}-123456`,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(rejectionCodes(results)).toEqual(["QUEUE_FULL"]);
    expect(connections[0].jobs.countActive()).toBe(1);
  });

  it("atomically enforces five active jobs per service account", async () => {
    const {
      services,
      actor,
      databases: connections,
    } = await concurrentFixture({
      maxStorage: 100,
      maxQueue: 20,
    });
    const timestamp = new Date().toISOString();
    for (let index = 0; index < 4; index += 1)
      connections[0].jobs.insertReserved({
        id: `job_${String(index).padStart(32, "0")}`,
        userId: actor.userId,
        serviceAccountId: actor.serviceAccountId,
        apiKeyId: actor.apiKeyId,
        rendererVersion: "test",
        sourceSize: 1,
        sourceSha256: "f".repeat(64),
        timestamp,
        reservedOutputBytes: 0,
      });
    const results = await Promise.allSettled(
      services.map((service, index) =>
        service.create(
          actor,
          { size: 1, sha256: String(index + 2).repeat(64) },
          `concurrent-account-${index}-123456`,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(rejectionCodes(results)).toEqual(["ACCOUNT_QUEUE_LIMIT"]);
    expect(
      connections[0].jobs.countActiveForServiceAccount(actor.serviceAccountId),
    ).toBe(5);
  });

  it("atomically reserves per-user storage across database connections", async () => {
    const {
      services,
      actor,
      databases: connections,
    } = await concurrentFixture({
      maxStorage: 10,
      maxQueue: 20,
    });
    const results = await Promise.allSettled(
      services.map((service, index) =>
        service.create(
          actor,
          { size: 6, sha256: String(index + 3).repeat(64) },
          `concurrent-storage-${index}-123456`,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(rejectionCodes(results)).toEqual(["USER_STORAGE_QUOTA"]);
    expect(connections[0].jobs.storageUsageForUser(actor.userId)).toBe(7);
  });

  it("enforces the active Job limit across a user's service accounts", async () => {
    const { database, service, actor } = fixture({
      maxStorage: 100,
      maxQueue: 20,
    });
    const timestamp = new Date().toISOString();
    database.settings.upsert("max_user_active_jobs", 1, "test", timestamp);
    database.jobs.insertReserved({
      id: `job_${"c".repeat(32)}`,
      userId: actor.userId,
      serviceAccountId: actor.serviceAccountId,
      apiKeyId: actor.apiKeyId,
      rendererVersion: "test",
      sourceSize: 1,
      sourceSha256: "c".repeat(64),
      timestamp,
      reservedOutputBytes: 1,
    });
    database.raw
      .prepare(
        "INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('service_two','user','Service two','generic','active',1,?,?)",
      )
      .run(timestamp, timestamp);
    database.raw
      .prepare(
        "INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key_two','service_two','Key two','prefix-two','hash','v1','[\"render:create\"]',?,'test')",
      )
      .run(timestamp);

    await expect(
      service.create(
        {
          ...actor,
          serviceAccountId: "service_two",
          apiKeyId: "key_two",
        },
        { size: 1, sha256: "d".repeat(64) },
        "user-queue-limit-123456",
      ),
    ).rejects.toMatchObject({ code: "USER_QUEUE_LIMIT", status: 429 });
  });

  it("atomically reserves maximum future output bytes for Source-based Jobs", async () => {
    const {
      services,
      actor,
      databases: connections,
    } = await concurrentFixture({
      maxStorage: 10,
      maxQueue: 20,
      maxOutput: 6,
    });
    const timestamp = new Date().toISOString(),
      sourceId = `source_${"e".repeat(32)}`;
    connections[0].sources.insertReserved({
      id: sourceId,
      ownerUserId: actor.userId,
      size: 1,
      sha256: "e".repeat(64),
      storageKey: `sources/${sourceId}/source.zip`,
      timestamp,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    connections[0].raw
      .prepare(
        "UPDATE sources SET status='ready',uploaded_at=?,paths_json='[\"main.tex\"]' WHERE id=?",
      )
      .run(timestamp, sourceId);
    const results = await Promise.allSettled(
      services.map((service, index) =>
        service.create(
          actor,
          { sourceId },
          `concurrent-output-${index}-123456`,
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(rejectionCodes(results)).toEqual(["USER_STORAGE_QUOTA"]);
    expect(connections[0].jobs.storageUsageForUser(actor.userId)).toBe(7);
  });
});

function fixture(options: {
  maxStorage: number;
  maxQueue: number;
  maxOutput?: number;
}) {
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
      `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key','service','Key','prefix','hash','v1','["render:create"]',?,'test')`,
    )
    .run(timestamp);
  const actor: AuthenticatedServiceAccount = {
    apiKeyId: "key",
    serviceAccountId: "service",
    userId: "user",
    userSecurityVersion: 1,
    serviceAccountSecurityVersion: 1,
    scopes: ["render:create"],
    keyKind: "render",
  };
  const tickets = new TicketService(
    database,
    "latex-renderer",
    "latex-render",
    { kid: "v1", secret: Buffer.alloc(32, 8) },
    [],
  );
  const apiKeys = new ApiKeyService(
    database,
    new Map([["v1", Buffer.alloc(32, 7)]]),
    "v1",
  );
  const deps = {
    database,
    apiKeys,
    tickets,
    rendererPublicUrl: "https://latex.example.com",
    rendererVersion: "test",
    maxUploadBytes: 20 * 1024 * 1024,
    maxOutputBytes: options.maxOutput ?? 1,
    maxQueueLength: options.maxQueue,
    maxUserStorageBytes: options.maxStorage,
  };
  const service = new RenderTicketsService(deps),
    app = createInternalApp(deps);
  return { database, service, actor, tickets, apiKeys, app };
}

function insertKey(f: ReturnType<typeof fixture>, serviceAccountId: string) {
  const key = f.apiKeys.create("render");
  f.database.apiKeys.insert({
    id: key.id,
    serviceAccountId,
    name: key.id,
    prefix: key.prefix,
    kind: key.kind,
    secretHash: key.secretHash,
    pepperId: key.pepperId,
    scopes: ["render:create", "render:read:own"],
    createdAt: new Date().toISOString(),
    createdBy: "fixture",
  });
  return key;
}

function readySource(database: RendererDatabase) {
  const id = `source_${"e".repeat(32)}`,
    timestamp = new Date().toISOString();
  database.sources.insertReserved({
    id,
    ownerUserId: "user",
    size: 1,
    sha256: "e".repeat(64),
    storageKey: `sources/${id}/source.zip`,
    timestamp,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  database.raw
    .prepare(
      "UPDATE sources SET status='ready',uploaded_at=?,paths_json='[\"main.tex\"]' WHERE id=?",
    )
    .run(timestamp, id);
  return id;
}

async function concurrentFixture(options: {
  maxStorage: number;
  maxQueue: number;
  maxOutput?: number;
}) {
  const root = await mkdtemp(join(tmpdir(), "render-admission-"));
  roots.push(root);
  const path = join(root, "renderer.sqlite3"),
    first = new RendererDatabase(path);
  databases.push(first);
  first.migrate();
  const timestamp = new Date().toISOString();
  first.raw
    .prepare(
      `INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES ('user','subject','user@example.test','User','user','active',1,'test',?,?)`,
    )
    .run(timestamp, timestamp);
  first.raw
    .prepare(
      `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES ('service','user','Service','generic','active',1,?,?)`,
    )
    .run(timestamp, timestamp);
  first.raw
    .prepare(
      `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key','service','Key','prefix','hash','v1','["render:create"]',?,'test')`,
    )
    .run(timestamp);
  const second = new RendererDatabase(path);
  databases.push(second);
  const actor: AuthenticatedServiceAccount = {
    apiKeyId: "key",
    serviceAccountId: "service",
    userId: "user",
    userSecurityVersion: 1,
    serviceAccountSecurityVersion: 1,
    scopes: ["render:create"],
    keyKind: "render",
  };
  const services = [first, second].map(
    (database) =>
      new RenderTicketsService({
        database,
        apiKeys: {} as never,
        tickets: new TicketService(
          database,
          "latex-renderer",
          "latex-render",
          { kid: "v1", secret: Buffer.alloc(32, 8) },
          [],
        ),
        rendererPublicUrl: "https://latex.example.com",
        rendererVersion: "test",
        maxUploadBytes: 20 * 1024 * 1024,
        maxOutputBytes: options.maxOutput ?? 1,
        maxQueueLength: options.maxQueue,
        maxUserStorageBytes: options.maxStorage,
      }),
  );
  return { services, actor, databases: [first, second] as const };
}

function rejectionCodes(
  results: readonly PromiseSettledResult<unknown>[],
): string[] {
  return results
    .filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )
    .map((result) => (result.reason as { code?: string }).code ?? "UNKNOWN");
}
