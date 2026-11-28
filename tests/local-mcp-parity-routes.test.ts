import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ApiKeyService } from "@latex-renderer/auth";
import {
  RendererDatabase,
  artifactStoragePath,
} from "@latex-renderer/database";
import { sha256Hex } from "@latex-renderer/shared";
import { TicketService } from "@latex-renderer/ticket";
import type { RenderApiScope } from "../packages/contracts/src/index.js";
import { createInternalApp } from "../apps/internal-api/src/app.js";
import {
  gatewayRoute,
  proxyGatewayJson,
} from "../packages/gateway-core/src/index.js";
import { afterEach, describe, expect, it } from "vitest";

const jobId = `job_${"1".repeat(32)}`;
const secondJob = `job_${"2".repeat(32)}`;
const sourceId = `source_${"1".repeat(32)}`;
const runtimeDigest = `sha256:${"a".repeat(64)}`;
const pdfBytes = "%PDF-1.7\n%%EOF\n";
const pdfSha256 = sha256Hex(pdfBytes);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "local-mcp-parity-"));
  const database = new RendererDatabase(":memory:");
  cleanups.push(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  database.migrate();
  const now = new Date().toISOString();
  const userId = "user_local";
  const serviceAccountId = "service_local";
  const rendererVersion = `renderer@test@${runtimeDigest}`;
  database.users.insertInvitation({
    id: userId,
    displayName: "Local",
    role: "user",
    createdBy: "test",
    timestamp: now,
  });
  database.serviceAccounts.insert({
    id: serviceAccountId,
    ownerUserId: userId,
    name: "Local",
    clientType: "generic",
    timestamp: now,
  });
  const apiKeys = new ApiKeyService(
    database,
    new Map([["v1", Buffer.alloc(32, 5)]]),
    "v1",
  );
  function key(scopes: RenderApiScope[]) {
    const generated = apiKeys.create("render");
    database.apiKeys.insert({
      ...generated,
      serviceAccountId,
      scopes,
      name: generated.id,
      createdAt: now,
      createdBy: "test",
    });
    return generated;
  }
  const scopes: RenderApiScope[] = [
    "render:create",
    "render:read:own",
    "render:pdf:inspect",
  ];
  const original = key(scopes);
  const successor = key(scopes);
  const independent = key(scopes);
  const createOnly = key(["render:create"]);
  const readOnly = key(["render:read:own"]);
  const pdfOnly = key(["render:pdf:inspect"]);
  database.sources.insertReserved({
    id: sourceId,
    ownerUserId: userId,
    size: 10,
    sha256: "b".repeat(64),
    storageKey: `sources/${sourceId}/source.zip`,
    timestamp: now,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });
  database.raw
    .prepare("UPDATE sources SET status='ready' WHERE id=?")
    .run(sourceId);
  function seedJob(id: string, apiKeyId: string) {
    expect(
      database.jobs.insertQueued({
        id,
        apiKeyId,
        userId,
        serviceAccountId,
        rendererVersion,
        sourceId,
        entrypoint: "main.tex",
        timestamp: now,
        outputs: ["pdf", "svg"],
        reservedOutputBytes: 1024,
      }),
    ).toBe(1);
    database.raw
      .prepare("UPDATE jobs SET status='succeeded',completed_at=? WHERE id=?")
      .run(now, id);
  }
  seedJob(jobId, original.id);
  seedJob(secondJob, independent.id);
  database.apiKeys.revoke(original.id, now);
  expect(database.apiKeys.recordRotation(original.id, successor.id)).toBe(true);

  const environmentRoot = join(root, "environment");
  await mkdir(environmentRoot);
  await writeFile(join(environmentRoot, "packages.txt"), "amsmath\ntikz\n");
  await writeFile(join(environmentRoot, "fonts.txt"), "Latin Modern Roman\n");
  const uploadBytes = 1024 * 1024;
  const app = createInternalApp({
    database,
    apiKeys,
    tickets: new TicketService(
      database,
      "latex-renderer",
      "latex-render",
      { kid: "v1", secret: Buffer.alloc(32, 6) },
      [],
    ),
    rendererPublicUrl: "https://renderer.example.test",
    rendererVersion,
    environmentRoot,
    storageRoot: root,
    maxUploadBytes: uploadBytes,
    maxOutputBytes: uploadBytes,
    maxQueueLength: 20,
    maxUserStorageBytes: 10 * uploadBytes,
  });
  function request(
    token: string,
    method: string,
    path: string,
    payload?: object,
  ) {
    return app.request(`/internal/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
  }
  async function artifact(
    id: string,
    relativePath: string,
    type: string,
    content: string,
  ) {
    const row = {
      id: `artifact_${sha256Hex(id + relativePath).slice(0, 32)}`,
      job_id: id,
      relative_path: relativePath,
      type,
      size: Buffer.byteLength(content),
      sha256: sha256Hex(content),
      created_at: now,
    };
    const path = artifactStoragePath(root, row);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
    database.artifacts.insert(row);
    return row;
  }
  return {
    database,
    request,
    artifact,
    successor,
    independent,
    createOnly,
    readOnly,
    pdfOnly,
  };
}

describe("Local MCP parity Internal API routes", () => {
  it("gates all environment operations on render:create and queues a deduplicated synthetic probe", async () => {
    const f = await fixture();
    const cases = [
      [
        "GET",
        "/environment",
        undefined,
        {
          capabilities: {
            runtimeDigest,
            attachmentImport: false,
            contractVersion: 2,
          },
        },
      ],
      [
        "GET",
        "/environment/profiles",
        undefined,
        { profiles: [{ id: "tagged-ja-v1", state: "not_checked" }] },
      ],
      [
        "POST",
        "/environment/packages/check",
        { names: ["amsmath", "missing"] },
        {
          packages: [
            { name: "amsmath", available: true },
            { name: "missing", available: false },
          ],
        },
      ],
      [
        "GET",
        "/environment/packages/search?query=ams&cursor=0",
        undefined,
        { search: { matches: ["amsmath"] } },
      ],
      [
        "POST",
        "/environment/fonts/check",
        { names: ["Latin Modern Roman"] },
        { fonts: [{ name: "Latin Modern Roman", available: true }] },
      ],
      [
        "GET",
        "/environment/fonts/search?query=modern",
        undefined,
        { search: { matches: ["Latin Modern Roman"] } },
      ],
      [
        "POST",
        "/environment/requirements/check",
        {
          engine: "lualatex",
          requirements: [{ kind: "feature", name: "network" }],
        },
        { runtimeDigest, items: [{ state: "unsupported_by_sandbox" }] },
      ],
      [
        "POST",
        "/environment/requirements/probe",
        { engine: "lualatex", packages: ["amsmath"] },
        {
          runtimeDigest,
          state: "queued",
          scope: "isolated_synthetic_document",
        },
      ],
    ] as const;
    for (const [method, path, payload, expected] of cases) {
      expect(
        (await f.request(f.readOnly.token, method, path, payload)).status,
        path,
      ).toBe(403);
      const response = await f.request(
        f.createOnly.token,
        method,
        path,
        payload,
      );
      expect(response.status, path).toBe(200);
      const result: unknown = await response.json();
      expect(result, path).toMatchObject(expected);
      if (path.endsWith("/probe"))
        expect(
          await (
            await f.request(f.createOnly.token, method, path, payload)
          ).json(),
        ).toEqual(result);
    }
  });

  it("uses the render:create scope and credential lineage for whole-Job retries", async () => {
    const f = await fixture();
    const path = `/jobs/${jobId}/retry`;
    const body = { idempotencyKey: "local-retry-00000001" };
    expect((await f.request(f.readOnly.token, "POST", path, body)).status).toBe(
      403,
    );
    expect(
      (await f.request(f.createOnly.token, "POST", path, body)).status,
    ).toBe(404);
    expect(
      (await f.request(f.independent.token, "POST", path, body)).status,
    ).toBe(404);
    const first = await f.request(f.successor.token, "POST", path, body);
    expect(first.status).toBe(200);
    const result = (await first.json()) as { job: { id: string } };
    expect(result).toMatchObject({
      job: {
        status: "queued",
        sourceId,
        retryOf: jobId,
        outputs: ["pdf", "svg"],
      },
    });
    expect(result.job.id).not.toBe(jobId);
    expect(
      await (await f.request(f.successor.token, "POST", path, body)).json(),
    ).toEqual(result);
    expect(
      (
        await f.request(
          f.successor.token,
          "POST",
          `/jobs/${result.job.id}/retry`,
          {},
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(
          f.successor.token,
          "POST",
          `/jobs/${result.job.id}/ticket`,
        )
      ).status,
    ).toBe(200);
  });

  it("reads diagnostics, byte or line windows, and manifest only from the same key lineage", async () => {
    const f = await fixture();
    const logText = "one\ntwo\nthree\n";
    const log = await f.artifact(jobId, "compile.log", "log", logText);
    await f.artifact(
      jobId,
      "errors.json",
      "errors",
      JSON.stringify({
        errors: [
          { type: "latex-error", file: "main.tex", line: 1, message: "First" },
        ],
        warnings: [
          {
            type: "latex-warning",
            file: "main.tex",
            line: 2,
            message: "Second",
          },
        ],
      }),
    );
    await f.artifact(jobId, "result.pdf", "pdf", pdfBytes);
    const cases = [
      [
        "diagnostics?stage=pdf&offset=1&limit=1",
        {
          diagnostics: {
            stage: "pdf",
            diagnostics: [{ message: "Second", severity: "warning" }],
            coverage: { offset: 1, storedItems: 2, nextOffset: null },
            rawLogResourceUri: null,
          },
        },
      ],
      [
        `log?startByte=4&sha256=${log.sha256}`,
        { log: { startByte: 4, text: "two\nthree\n", sha256: log.sha256 } },
      ],
      [
        "log?startLine=3",
        { log: { startLine: 3, startByte: 8, text: "three\n" } },
      ],
      [
        "manifest",
        {
          jobId,
          sourceId,
          pdfSha256,
          inputKind: "source_zip",
          schemaVersion: 1,
        },
      ],
    ] as const;
    for (const [suffix, expected] of cases) {
      const path = `/jobs/${jobId}/${suffix}`;
      expect((await f.request(f.createOnly.token, "GET", path)).status).toBe(
        403,
      );
      expect((await f.request(f.independent.token, "GET", path)).status).toBe(
        404,
      );
      const response = await f.request(f.successor.token, "GET", path);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject(expected);
    }
    expect(
      (
        await f.request(
          f.successor.token,
          "GET",
          `/jobs/${jobId}/log?sha256=${"0".repeat(64)}`,
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await f.request(
          f.successor.token,
          "GET",
          `/jobs/${jobId}/log?startByte=1&startLine=2`,
        )
      ).status,
    ).toBe(400);
  });

  it("queues distinct PDF crops, sheets and SyncTeX queries and compares reports only after authorizing both jobs", async () => {
    const f = await fixture();
    const pdf = await f.artifact(jobId, "result.pdf", "pdf", pdfBytes);
    await f.artifact(secondJob, "result.pdf", "pdf", pdfBytes);
    f.database.artifacts.recordSourceMap(pdf.id, "f".repeat(64), 10, [
      "main.tex",
    ]);
    const path = `/jobs/${jobId}/pdf-inspection`;
    const cases = [
      { page: 1, x: 0, y: 0, width: 1, height: 1 },
      { pages: [2, 1] },
      { direction: "source_to_pdf", path: "main.tex", line: 5 },
      { direction: "pdf_to_source", page: 1, x: 2, y: 3 },
    ] as const;
    for (const params of cases) {
      const payload = { pdfSha256, params };
      expect(
        (await f.request(f.createOnly.token, "POST", path, payload)).status,
      ).toBe(403);
      expect(
        (await f.request(f.independent.token, "POST", path, payload)).status,
      ).toBe(404);
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await f.request(
          f.successor.token,
          "POST",
          path,
          payload,
        );
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          jobId,
          pdfSha256,
          state: "queued",
        });
      }
    }
    expect(
      f.database.raw
        .prepare(
          "SELECT count(*) AS count FROM pdf_inspections WHERE job_id=? AND params_json IS NOT NULL",
        )
        .get(jobId),
    ).toMatchObject({ count: cases.length });
    expect(
      await (
        await f.request(
          f.successor.token,
          "GET",
          `${path}?pdfSha256=${pdfSha256}`,
        )
      ).json(),
    ).toMatchObject({ state: "not_requested" });
    expect(
      (
        await f.request(f.successor.token, "POST", path, {
          pdfSha256,
          params: { pages: [1, 1] },
        })
      ).status,
    ).toBe(400);
    const before = { jobId, pdfSha256 };
    const compare = "/pdf-inspections/compare";
    expect(
      (
        await f.request(f.readOnly.token, "POST", compare, {
          before,
          after: before,
        })
      ).status,
    ).toBe(403);
    const foreign = { jobId: secondJob, pdfSha256 };
    for (const body of [
      { before, after: foreign },
      { before: foreign, after: before },
    ])
      expect(
        (await f.request(f.successor.token, "POST", compare, body)).status,
      ).toBe(404);
    const response = await f.request(f.successor.token, "POST", compare, {
      before,
      after: before,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      samePdfBytes: true,
      sameEngine: true,
      visual: "not_checked",
      before: { state: "not_requested" },
    });

    const report = {
      checks: {
        versions: { text: "fixture", truncated: false },
        "page-rasters": { text: "e".repeat(64), truncated: false },
        "extracted-text": { text: "Example", truncated: false },
      },
    };
    const quality = await f.request(f.successor.token, "POST", path, {
      pdfSha256,
    });
    expect(quality.status).toBe(200);
    const row = f.database.pdfInspections.forArtifact(pdf);
    if (!row) throw new Error("Expected a queued quality report");
    // Simulate the worker publishing an inspection for the exact stored PDF.
    f.database.raw
      .prepare(
        "UPDATE pdf_inspections SET status='ready',result_json=? WHERE id=?",
      )
      .run(JSON.stringify(report), row.id);
    const compared = await f.request(f.successor.token, "POST", compare, {
      before,
      after: before,
    });
    expect(compared.status).toBe(200);
    expect(await compared.json()).toMatchObject({
      visual: "same_observation",
      extractedText: "same_observation",
      visualCoverage: { comparedPages: 1, changedPreviewPages: [] },
      before: { state: "ready" },
    });
  });
});

describe("Local MCP parity Gateway allowlist", () => {
  const job = `/job-tickets/${jobId}`;
  const routes = [
    ["GET", "/environment"],
    ["GET", "/environment/profiles"],
    ["POST", "/environment/packages/check"],
    ["GET", "/environment/packages/search"],
    ["POST", "/environment/fonts/check"],
    ["GET", "/environment/fonts/search"],
    ["POST", "/environment/requirements/check"],
    ["POST", "/environment/requirements/probe"],
    ["POST", `${job}/retry`],
    ["GET", `${job}/diagnostics`],
    ["GET", `${job}/log`],
    ["GET", `${job}/manifest`],
    ["GET", `${job}/pdf-inspection`],
    ["POST", `${job}/pdf-inspection`],
    ["POST", "/pdf-inspections/compare"],
  ];
  it.each(routes)(
    "forwards %s %s and rejects an unsupported method",
    (method, path) => {
      expect(gatewayRoute(`/api/v1${path}`, method)).toEqual({
        upstreamPath: `/internal/v1${path.replace("/job-tickets/", "/jobs/")}`,
        bodyRequired: method === "POST",
        idempotencyRequired: false,
      });
      expect(gatewayRoute(`/api/v1${path}`, "PATCH")).toBe(
        "method-not-allowed",
      );
    },
  );

  it("does not allow arbitrary subroutes or job IDs", () => {
    expect(
      gatewayRoute("/api/v1/environment/packages/remove", "POST"),
    ).toBeUndefined();
    expect(gatewayRoute("/api/v1/pdf-inspections", "GET")).toBeUndefined();
    expect(gatewayRoute("/api/v1/job-tickets/wrong/log", "GET")).toBe(
      "invalid-job",
    );
    expect(gatewayRoute(`/api/v1${job}/artifacts`, "GET")).toBe("invalid-job");
  });

  it("preserves query parameters and forwards a supported requirement request larger than the ticket body limit", async () => {
    const authorization = `Bearer lrk_${"a".repeat(32)}_${"A".repeat(43)}`;
    const logUrl = `https://example.test/api/v1${job}/log?stage=svg&startLine=5`;
    const body = JSON.stringify({
      engine: "lualatex",
      requirements: Array.from({ length: 32 }, () => ({
        kind: "font",
        name: "Font",
        characters: "あ".repeat(100),
      })),
    });
    const cases = [
      [
        new Request(logUrl, { headers: { Authorization: authorization } }),
        `/internal/v1/jobs/${jobId}/log`,
        false,
      ],
      [
        new Request(
          "https://example.test/api/v1/environment/requirements/check",
          {
            method: "POST",
            headers: {
              Authorization: authorization,
              "Content-Type": "application/json",
              "Content-Length": String(Buffer.byteLength(body)),
            },
            body,
          },
        ),
        "/internal/v1/environment/requirements/check",
        true,
      ],
    ] as const;
    for (const [request, upstreamPath, bodyRequired] of cases) {
      const response = await proxyGatewayJson({
        request,
        upstreamPath,
        bodyRequired,
        requestId: "test",
        fetchUpstream: async (url, init) => {
          expect(url.pathname).toBe(upstreamPath);
          expect(url.search).toBe(new URL(request.url).search);
          if (bodyRequired)
            expect(await new Response(init.body).text()).toBe(body);
          return Response.json({ forwarded: true });
        },
      });
      expect(await response.json()).toEqual({ forwarded: true });
    }
  });
});
