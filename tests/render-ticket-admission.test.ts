import { afterEach, describe, expect, it } from "vitest";
import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import type { AuthenticatedServiceAccount } from "@latex-renderer/auth";
import { ApiKeyService } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { TicketService } from "@latex-renderer/ticket";
import { gatewayRoute, proxyGatewayJson } from "../packages/gateway-core/src/index.js";
import { AdminApiKeysService } from "../apps/admin-api/src/services/api-keys.js";
import { createInternalApp } from "../apps/internal-api/src/app.js";
import { RenderTicketsService } from "../apps/internal-api/src/services/render-tickets.js";

const databases: RendererDatabase[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("reads saved revision files only with the explicit scope and matching owner", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "saved-revision-files-"));
  roots.push(storageRoot);
  const f = fixture({ maxStorage: 10000, maxQueue: 20, storageRoot });
  const sourceId = readySource(f.database);
  const projectId = `project_${"1".repeat(32)}`;
  const revisionId = `revision_${"2".repeat(32)}`;
  const timestamp = new Date().toISOString();
  f.database.projects.insert({ id: projectId, ownerUserId: "user", displayName: "Shared", timestamp });
  f.database.projects.insertRevision({
    id: revisionId, projectId, sourceId, displayName: "Revision",
    originalFilename: "main.tex", entrypoint: "main.tex", timestamp,
  });
  const sourceDirectory = join(storageRoot, "sources", sourceId);
  await mkdir(sourceDirectory, { recursive: true });
  const zip = new yazl.ZipFile();
  const contents = "日本語𝑥";
  zip.addBuffer(Buffer.from(contents), "main.tex");
  const write = pipeline(zip.outputStream, createWriteStream(join(sourceDirectory, "source.zip")));
  zip.end();
  await write;

  f.database.raw.prepare(
    `INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
     VALUES ('other','other-subject','other@example.test','Other','user','active',1,'test',?,?)`,
  ).run(timestamp, timestamp);
  f.database.serviceAccounts.insert({
    id: "other-account", ownerUserId: "other", name: "Other",
    clientType: "generic", timestamp,
  });
  const endpoint = `/internal/v1/projects/${projectId}/revisions/${revisionId}/files`;
  const request = (token: string, query = "", method = "GET") =>
    f.app.request(endpoint + query, { method, headers: { Authorization: `Bearer ${token}` } });
  const base = insertKey(f, "service");
  const own = insertKey(f, "service", ["render:project:read"]);
  const other = insertKey(f, "other-account", ["render:project:read"]);
  expect((await request(base.token)).status).toBe(403);
  expect((await request(other.token)).status).toBe(404);
  expect((await request(own.token, "", "POST")).status).toBe(404);
  const listed = await request(own.token, "?limit=1");
  expect(listed.status).toBe(200);
  expect(listed.headers.get("Cache-Control")).toContain("no-store");
  await expect(listed.json()).resolves.toMatchObject({
    projectId, revisionId, sourceId,
    items: [{ path: "main.tex", kind: "text", size: Buffer.byteLength(contents) }],
    totalFiles: 1, nextOffset: null,
  });
  const read = await request(own.token, "?path=main.tex&offset=3");
  expect(read.status).toBe(200);
  await expect(read.json()).resolves.toMatchObject({
    projectId, revisionId, sourceId, path: "main.tex",
    text: "𝑥", offset: 3, unit: "utf16", totalUnits: 5, nextOffset: null,
  });
});

it("requires an authorized rendering key to disclose the effective ZIP limits", async () => {
  const f = fixture({ maxStorage: 100, maxQueue: 20 });
  const key = insertKey(f, "service");
  const anonymous = await f.app.request("/internal/v1/source-tickets");
  expect(anonymous.status).toBe(401);
  const response = await f.app.request("/internal/v1/source-tickets", {
    headers: { Authorization: `Bearer ${key.token}` },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  await expect(response.json()).resolves.toEqual({
    maxUploadBytes: 20 * 1024 ** 2, maxExtractedBytes: 100 * 1024 ** 2,
    maxFileCount: 500, maxZipEntries: 1000,
  });
});

it("opens, edits and saves a draft across the Gateway with independent scopes", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "render-authoring-"));
  roots.push(storageRoot);
  const f = fixture({ maxStorage: 2 * 1024 * 1024, maxQueue: 20, storageRoot });
  const projectId = `project_${"3".repeat(32)}`;
  f.database.projects.insert({
    id: projectId, ownerUserId: "user", displayName: "Draft", timestamp: new Date().toISOString(),
  });
  const base = insertKey(f, "service");
  const reader = insertKey(f, "service", ["render:draft:read"]);
  const writer = insertKey(f, "service", ["render:draft:write"]);
  const text = "% " + "shared draft ".repeat(350);
  async function call(token: string, suffix = "", data?: object) {
    const url = new URL(`https://renderer.example.test/api/v1/projects/${projectId}/draft${suffix}`);
    const body = data === undefined ? undefined : JSON.stringify(data);
    const method = body === undefined ? "GET" : "POST";
    const route = gatewayRoute(url.pathname, method);
    if (typeof route !== "object") throw new Error("Missing Gateway route");
    const response = await proxyGatewayJson({
      ...route, requestId: "authoring-test",
      request: new Request(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : {
            "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)),
          }),
        },
        ...(body === undefined ? {} : { body }),
      }),
      fetchUpstream: async (target, init) => await f.app.request(target, init),
    });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    return { status: response.status, value: await response.json() as unknown };
  }
  await expect(call(base.token)).resolves.toMatchObject({ status: 403 });
  await expect(call(writer.token)).resolves.toMatchObject({ status: 403 });
  await expect(call(reader.token)).resolves.toEqual({ status: 200, value: { draft: null } });
  await expect(call(reader.token, "/open", {})).resolves.toMatchObject({ status: 403 });
  const opened = await call(writer.token, "/open", {});
  expect(opened).toMatchObject({ status: 200, value: { draft: { version: 1 } } });
  const changes = {
    version: 1, idempotencyKey: "draft-authoring-key-2026", files: [{ path: "main.tex", text }],
  };
  const applied = await call(writer.token, "/changes", changes);
  expect(applied).toMatchObject({ status: 200, value: { version: 2, changedPaths: ["main.tex"] } });
  await expect(call(writer.token, "/changes", changes)).resolves.toEqual(applied);
  await expect(call(writer.token, "/changes", { ...changes, idempotencyKey: "another-authoring-key-2026" }))
    .resolves.toMatchObject({ status: 409, value: { error: { code: "DRAFT_VERSION_CONFLICT", currentVersion: 2 } } });
  await expect(call(reader.token, "/file?version=2&path=main.tex"))
    .resolves.toMatchObject({ status: 200, value: { text: text.slice(0, 4000), nextOffset: 4000 } });
  await expect(call(writer.token, "/save", { version: 2, displayName: "Reviewed" }))
    .resolves.toMatchObject({ status: 200, value: { revision: { projectId, revisionNumber: 1 } } });
});

it("inspects only the exact PDF of a job owned by an explicitly authorized key", async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), "render-pdf-quality-"));
  roots.push(storageRoot);
  const f = fixture({ maxStorage: 100, maxQueue: 20, storageRoot });
  const owner = insertKey(f, "service", ["render:create", "render:pdf:inspect"]);
  const unrelated = insertKey(f, "service", ["render:pdf:inspect"]);
  const old = insertKey(f, "service");
  const { jobId } = (await f.service.create(
    f.apiKeys.authenticate(owner.token), { sourceId: readySource(f.database) }, "inspect-job-key-2026",
  )).value;
  const timestamp = new Date().toISOString();
  f.database.raw.prepare("UPDATE jobs SET status='succeeded',completed_at=? WHERE id=?")
    .run(timestamp, jobId);
  const sha256 = "a".repeat(64);
  f.database.artifacts.insert({
    id: "pdf-fixture", job_id: jobId, type: "pdf", relative_path: "result.pdf",
    storage_generation: null, size: 1, sha256, created_at: timestamp,
  });
  const path = `/internal/v1/jobs/${jobId}/pdf-inspection`;
  const request = (token: string, requestInspection = false, digest = sha256) =>
    f.app.request(requestInspection ? path : `${path}?pdfSha256=${digest}`, {
      method: requestInspection ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      ...(requestInspection ? { body: JSON.stringify({ pdfSha256: digest }) } : {}),
    });
  expect((await request(old.token, true)).status).toBe(403);
  expect((await request(unrelated.token, true)).status).toBe(404);
  expect((await request(owner.token, true, "b".repeat(64))).status).toBe(409);
  const result = await request(owner.token, true);
  expect(result.status).toBe(200);
  await expect(result.json()).resolves.toMatchObject({ jobId, pdfSha256: sha256, state: "queued" });
  await expect((await request(owner.token)).json()).resolves.toMatchObject({ state: "queued" });
  expect(f.database.jobs.countActive()).toBe(0);
  expect(f.database.raw.prepare("SELECT COUNT(*) count FROM pdf_inspections").get()).toEqual({ count: 1 });
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

  it("keeps a queued Job and its replay accessible only to the active successor of its original key", async () => {
    const f = fixture({ maxStorage: 100, maxQueue: 20 });
    const { database, service, tickets, apiKeys } = f;
    const original = insertKey(f, "service");
    const independent = insertKey(f, "service");
    const sourceId = readySource(database);
    const projectId = `project_${"1".repeat(32)}`;
    const revisionId = `revision_${"2".repeat(32)}`;
    const timestamp = new Date().toISOString();
    database.projects.insert({ id: projectId, ownerUserId: "user", displayName: "Shared", timestamp });
    database.projects.insertRevision({
      id: revisionId, projectId, sourceId, displayName: "Revision",
      originalFilename: "main.tex", entrypoint: "main.tex", timestamp,
    });
    const input = { sourceId, project: { projectId, revisionId } };
    const idempotencyKey = "rotation-in-progress-123456789";
    const created = await service.create(apiKeys.authenticate(original.token), input, idempotencyKey);
    const { jobId, jobTicket } = created.value;
    expect(database.jobs.getVisible(jobId)?.status).toBe("queued");
    const actions = new AdminApiKeysService({ database, apiKeys });
    const owner = { type: "user", id: "user", userId: "user", role: "owner" } as const;
    const rotated = actions.rotate(owner, original.id);
    const history = async (token: string) => {
      const response = await f.app.request(`/internal/v1/projects/${projectId}/revisions/${revisionId}/jobs`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(response.status).toBe(200);
      return (await response.json()) as unknown;
    };

    expect(database.jobs.getVisible(jobId)?.api_key_id).toBe(original.id);
    await expect(history(independent.token)).resolves.toMatchObject({
      items: [{ id: jobId, detailAccess: "different_connection" }],
    });
    await expect(history(rotated.apiKey)).resolves.toMatchObject({
      items: [{ id: jobId, detailAccess: "available" }],
    });
    expect(database.worker.subjectState(jobId)).toMatchObject({
      user_status: "active", sa_status: "active", revoked_at: null,
    });
    expect(() => actions.rotate(owner, original.id)).toThrow();
    expect(() => apiKeys.authenticate(original.token)).toThrow(/revoked/);
    await expect(tickets.verify(jobTicket, "status", jobId))
      .rejects.toMatchObject({ code: "TICKET_SUBJECT_INACTIVE" });
    await expect(service.renew(apiKeys.authenticate(independent.token), jobId))
      .rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
    const successor = apiKeys.authenticate(rotated.apiKey);
    const replayed = await service.create(successor, input, idempotencyKey);
    expect(replayed).toMatchObject({ status: 200, value: { jobId } });
    await expect(tickets.verify(replayed.value.jobTicket, "status", jobId))
      .resolves.toMatchObject({ api_key_id: rotated.id });

    const latest = actions.rotate(owner, rotated.id);
    const access = await service.renew(apiKeys.authenticate(latest.apiKey), jobId);
    await expect(tickets.verify(access.jobTicket, "download", jobId))
      .resolves.toMatchObject({ api_key_id: latest.id });
    await expect(tickets.verify(replayed.value.jobTicket, "status", jobId))
      .rejects.toMatchObject({ code: "TICKET_SUBJECT_INACTIVE" });
    actions.revoke(owner, latest.id);
    await expect(tickets.verify(access.jobTicket, "status", jobId))
      .rejects.toMatchObject({ code: "TICKET_SUBJECT_INACTIVE" });
    expect(database.worker.subjectState(jobId)).toBeUndefined();
    expect(database.apiKeys.activeJobIdentity(original.id, new Date().toISOString())).toBeUndefined();
  });

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
  storageRoot?: string;
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
    ...(options.storageRoot === undefined ? {} : { storageRoot: options.storageRoot }),
    maxUploadBytes: 20 * 1024 * 1024,
    maxOutputBytes: options.maxOutput ?? 1,
    maxQueueLength: options.maxQueue,
    maxUserStorageBytes: options.maxStorage,
  };
  const service = new RenderTicketsService(deps),
    app = createInternalApp(deps);
  return { database, service, actor, tickets, apiKeys, app };
}

function insertKey(
  f: ReturnType<typeof fixture>,
  serviceAccountId: string,
  scopes = ["render:create", "render:read:own"],
) {
  const key = f.apiKeys.create("render");
  f.database.apiKeys.insert({
    id: key.id,
    serviceAccountId,
    name: key.id,
    prefix: key.prefix,
    kind: key.kind,
    secretHash: key.secretHash,
    pepperId: key.pepperId,
    scopes,
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
