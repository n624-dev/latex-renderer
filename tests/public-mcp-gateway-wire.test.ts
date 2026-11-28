import { createHash, createPublicKey, sign } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RendererDatabase } from "@latex-renderer/database";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { describe, expect, it, vi } from "vitest";
import {
  rendererRelayAgentPaths,
  rendererRelaySocketMessage,
  rendererRelayVersion,
  type RendererMcpScope,
  type RendererRelayDownloadTarget,
} from "../packages/contracts/src/index.js";
import { RelayRpc } from "../packages/shared/src/relay-rpc.js";
import {
  RemoteOAuthService,
  RemoteRenderService,
} from "../packages/remote-mcp-core/src/index.js";
import { createAgentEnrollmentKeys } from "../apps/public-mcp-agent/src/enrollment.js";
import { createGatewayAgentSockets } from "../apps/public-mcp-gateway/src/agent-sockets.js";
import { GatewayAgentPairing } from "../apps/public-mcp-gateway/src/agent-pairing.js";
import { createDownloads } from "../apps/public-mcp-gateway/src/downloads.js";
import {
  authorizationLifetimeMs,
  GatewayOAuthTokens,
} from "../apps/public-mcp-gateway/src/oauth-tokens.js";
import { createPublicMcp } from "../apps/public-mcp-gateway/src/public-mcp.js";
import {
  isRecord,
  RelayReferences,
} from "../apps/public-mcp-gateway/src/relay-references.js";
import {
  RendererDispatch,
  type DispatchTransport,
} from "../apps/public-mcp-gateway/src/renderer-dispatch.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";
import { publicGatewayBearer } from "./helpers/public-mcp.js";
import { legacyTestBrowserAuth } from "./helpers/browser-auth.js";
import { createRemoteMcpApp } from "../apps/remote-mcp/src/app.js";
import { createRemoteMcpHandler } from "../apps/remote-mcp/src/mcp.js";
import { dispatchRelayOperation } from "../apps/remote-mcp/src/relay-operations.js";
import { assertCompleteWireCatalog } from "../apps/remote-mcp/testing/catalog.js";

const key = Buffer.alloc(32, 10);
const origin = "https://gateway.example.com";
const jobId = `job_${"a".repeat(32)}`;
const pdf = Buffer.from("%PDF-fixture");
const target = {
  kind: "artifact",
  jobId,
  path: "result.pdf",
  sha256: createHash("sha256").update(pdf).digest("hex"),
} satisfies RendererRelayDownloadTarget;

function authorization(
  store: SqliteConnectionStore,
  kind: "https" | "agent",
  scopes: RendererMcpScope[] = ["mcp:read", "mcp:render"],
) {
  const keys = createAgentEnrollmentKeys();
  const publicKey =
    createPublicKey(keys.agentPrivateKey).export({ format: "jwk" }).x ?? "";
  store.putVerifiedInstance({
    id: keys.instanceId,
    publicKey:
      createPublicKey(keys.instancePrivateKey).export({ format: "jwk" }).x ??
      "",
  });
  const profile = store.profileFor(keys.instanceId, "local-user");
  const transport = store.addTransport(
    keys.instanceId,
    kind === "agent"
      ? { kind, publicKey }
      : { kind, mcpUrl: "https://renderer.example.com/mcp" },
  );
  const now = Date.now();
  const credential =
    kind === "https" ? () => "fixture-opaque-credentials" : undefined;
  const input = {
    profileId: profile.id,
    transportId: transport.id,
    localGrantId: "local-grant",
    scopes,
    expiresAt: now + authorizationLifetimeMs,
  };
  if (scopes.includes("mcp:delete"))
    store.createAuthorization(
      { ...input, localGrantId: "base-grant", scopes: ["mcp:read"] },
      now,
      credential,
    );
  const auth = store.createAuthorization(input, now, credential);
  return { keys, auth, transport };
}

async function publicRequest<T>(
  mcp: ReturnType<typeof createPublicMcp>,
  token: string,
  method: string,
  params: unknown,
): Promise<T> {
  return toolRequest(mcp, origin, token, method, params);
}

async function toolRequest<T>(
  handle: (request: Request) => Response | Promise<Response | undefined>,
  endpointOrigin: string,
  token: string,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await handle(
    new Request(`${endpointOrigin}/mcp`, {
      method: "POST",
      headers: {
        Host: new URL(endpointOrigin).host,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
  );
  expect(response?.status).toBe(200);
  const body = await response?.text();
  const event = body?.split(/\r?\n/).find((line) => line.startsWith("data: "));
  return JSON.parse(event?.slice(6) ?? body ?? "null") as T;
}

function catalogFixture(
  store: SqliteConnectionStore,
  transport?: DispatchTransport,
) {
  const scopes = [
    "mcp:read",
    "mcp:render",
    "mcp:cancel",
    "mcp:delete",
  ] satisfies RendererMcpScope[];
  const { auth } = authorization(store, "https", scopes);
  const { auth: other } = authorization(store, "https", scopes);
  const tokens = new GatewayOAuthTokens(origin, store.oauth, key, 300_000);
  const token = publicGatewayBearer(tokens, auth);
  const otherToken = publicGatewayBearer(tokens, other);
  const references = new RelayReferences(key);
  const forward = vi.fn<DispatchTransport>().mockResolvedValue({
    result: { structuredContent: { success: true, result: {} } },
  });
  if (transport) forward.mockImplementation(transport);
  const mcp = createPublicMcp({
    version: "test",
    tokens,
    dispatch: new RendererDispatch(
      store,
      { https: forward, agent: forward },
      2,
    ),
    references,
    maxRequestBytes: 1024 * 1024,
    maxSourceBytes: 20 * 1024 * 1024,
    transport: (id) => store.transport(id),
  });
  return {
    auth,
    forward,
    seal: (id: string, kind = "object") => references.seal(auth, kind, id),
    open: (ref: string) => references.open(auth, "object", ref),
    catalog: () =>
      publicRequest<{
        result: { tools: { name: string; inputSchema: object }[] };
      }>(mcp, token, "tools/list", {}),
    call: (name: string, args: Record<string, unknown>, foreign = false) =>
      publicRequest<ToolReply>(
        mcp,
        foreign ? otherToken : token,
        "tools/call",
        { name, arguments: args },
      ),
  };
}

interface ToolReply {
  result: {
    structuredContent: {
      result?: Record<string, unknown>;
      error?: Record<string, unknown>;
    };
    content: { type: string; text?: string }[];
  };
}

function returnedReference(reply: ToolReply, field: string) {
  const object = reply.result.structuredContent.result?.[field];
  if (!isRecord(object) || typeof object.id !== "string")
    throw new Error(`Missing ${field} reference`);
  expect(object.id).toMatch(/^lrref_/);
  return object.id;
}

async function rendererFixture() {
  const storage = await mkdtemp(join(tmpdir(), "public-mcp-renderer-"));
  const database = new RendererDatabase(":memory:");
  const store = new SqliteConnectionStore(":memory:");
  const cleanup = async () => {
    store.close();
    database.close();
    await rm(storage, { recursive: true, force: true });
  };
  try {
    const issuer = "https://renderer.example.com";
    const resource = `${issuer}/mcp`;
    const userId = "user_test";
    database.migrate();
    database.users.insertInvitation({
      id: userId,
      email: "user@example.test",
      displayName: "Fixture User",
      role: "admin",
      createdBy: "test",
      timestamp: new Date().toISOString(),
    });
    const renders = new RemoteRenderService(
      database,
      storage,
      "renderer:test",
      issuer,
      100,
      1024 ** 3,
    );
    const mcp = createRemoteMcpHandler(renders, "test");
    const oauth = new RemoteOAuthService(database, issuer, resource);
    const app = createRemoteMcpApp({
      database,
      oauth,
      mcp,
      publicOrigin: issuer,
      browserAuth: legacyTestBrowserAuth(database, {
        verify: () =>
          Promise.reject(new Error("Unexpected browser authentication")),
      }),
    });
    const redirectUri = "http://127.0.0.1:49152/callback";
    const client = oauth.registerClient({
      clientName: "Direct fixture",
      redirectUris: [redirectUri],
    });
    const verifier = "v".repeat(64);
    const request = oauth.validateAuthorizationRequest(
      new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        resource,
        scope: "mcp:read mcp:render",
        code_challenge_method: "S256",
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      }),
    );
    const code = oauth.authorize(userId, request).searchParams.get("code");
    if (!code) throw new Error("Missing direct OAuth code");
    const token = oauth.exchangeAuthorizationCode({
      code,
      clientId: client.clientId,
      redirectUri,
      resource,
      codeVerifier: verifier,
    }).access_token;
    const gateway = catalogFixture(
      store,
      async ({ authorization, operation, signal }) => {
        const response = await dispatchRelayOperation({
          handler: mcp,
          publicOrigin: issuer,
          userId,
          clientId: authorization.localGrantId,
          scopes: authorization.scopes,
          operation,
          signal,
        });
        expect(response.status).toBe(200);
        return response.json() as Promise<unknown>;
      },
    );
    return {
      database,
      renders,
      userId,
      gateway,
      direct: (name: string, args: Record<string, unknown>) =>
        toolRequest<ToolReply>(app.fetch, issuer, token, "tools/call", {
          name,
          arguments: args,
        }),
      [Symbol.asyncDispose]: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

function catalogInputs(seal: ReturnType<typeof catalogFixture>["seal"]) {
  const projectId = seal(`project_${"a".repeat(32)}`);
  const revisionId = seal(`revision_${"b".repeat(32)}`);
  const sourceId = seal(`source_${"c".repeat(32)}`);
  const uploadId = sourceId;
  const job = { jobId: seal(jobId) };
  const project = { projectId };
  const revision = { projectId, revisionId };
  const draft = { projectId, version: 1 };
  const path = "main.tex";
  const file = { path, text: "Hello" };
  const sha256 = "f".repeat(64);
  const quality = { ...job, pdfSha256: sha256 };
  const selection = { projectId, revisionIds: [revisionId] };
  const displayName = "Test project";
  const idempotencyKey = "catalog-input-key-01";
  const attachment = {
    idempotencyKey,
    file: {
      file_id: "test-file",
      download_url: "https://files.example.test/file",
    },
  };
  return {
    get_authoring_guide: [{ topic: "remote" }],
    list_authoring_profiles: [{}],
    get_profile: [{}],
    import_source_attachment: [attachment],
    create_source: [{ files: [file] }],
    begin_source_upload: [{ expectedBytes: 4, sha256 }],
    upload_source_chunk: [{ uploadId, offset: 0, base64: "QUJDRA==" }],
    get_source_upload_status: [{ uploadId }],
    finalize_source_upload: [{ uploadId }],
    update_source_file: [{ sourceId, file }],
    delete_source_file: [{ sourceId, path }],
    create_source_ref: [{ sourceId }],
    create_render: [
      { inlineSource: file.text, reproducibility: { mode: "latest" } },
      {
        sourceId,
        reproducibility: { mode: "fixed", date: "2026-01-01T00:00:00Z" },
      },
      { sourceRef: seal(`source_ref_${"d".repeat(32)}`, "source-ref") },
    ],
    retry_render: [job],
    retry_svg_render: [{ ...job, idempotencyKey }],
    get_render_status: [job],
    request_render_quality_report: [quality],
    get_render_quality_report: [quality],
    get_render_preview_crop: [
      { ...quality, crop: { page: 1, x: 0, y: 0, width: 0.5, height: 0.5 } },
    ],
    request_attached_pdf_inspection: [attachment],
    get_attached_pdf_inspection: [
      { uploadId: seal(`pdfupload_${"e".repeat(32)}`), pdfSha256: sha256 },
    ],
    locate_render_source: [
      { ...quality, query: { direction: "source_to_pdf", path, line: 1 } },
      {
        ...quality,
        query: { direction: "pdf_to_source", page: 1, x: 0, y: 0 },
      },
    ],
    get_render_preview_sheet: [{ ...quality, sheet: { pages: [1] } }],
    compare_render_quality: [{ before: quality, after: quality }],
    get_render_manifest: [job],
    get_render_diagnostics: [job],
    read_render_log: [job],
    get_render_preview_pages: [{ ...quality, pages: [1] }],
    get_render_preview: [job],
    get_render_artifacts: [job],
    get_renderer_capabilities: [{}],
    check_document_requirements: [
      {
        engine: "lualatex",
        revision: { ...revision, inspectEntrypoint: true },
      },
    ],
    probe_document_requirements: [{ engine: "lualatex" }],
    cancel_render: [job],
    delete_render: [job],
    check_packages: [{ names: ["amsmath"] }],
    search_packages: [{ query: "ams", cursor: seal("40", "cursor") }],
    check_fonts: [{ names: ["Latin Modern"] }],
    search_fonts: [{ query: "Latin" }],
    list_projects: [{}],
    get_project: [project],
    get_project_document_state: [project],
    update_project_document_conditions: [
      { projectId, expectedVersion: 0, entries: [] },
    ],
    adopt_project_revision: [
      { ...revision, expectedRevisionId: revisionId },
      { projectId, revisionId: null, expectedRevisionId: revisionId },
      { ...revision, expectedRevisionId: null },
      { projectId, revisionId: null, expectedRevisionId: null },
    ],
    record_project_pdf_review: [
      {
        ...revision,
        ...quality,
        conditionsVersion: null,
        guideVersion: null,
        checks: [{ type: "visual", status: "passed" }],
      },
    ],
    list_project_pdf_reviews: [project],
    get_project_storage_usage: [project],
    protect_project_revision: [{ ...revision, protected: true }],
    plan_project_revision_cleanup: [selection],
    apply_project_revision_cleanup: [{ ...selection, planHash: sha256 }],
    get_project_draft: [project],
    open_project_draft: [revision],
    get_project_draft_file: [{ ...draft, path }],
    apply_project_changes: [
      {
        ...draft,
        idempotencyKey,
        files: [file, { path: "old.tex", remove: true }],
      },
    ],
    render_project_draft: [draft],
    save_project_draft: [{ ...draft, displayName }],
    get_project_revision_downloads: [revision],
    list_project_revision_files: [revision],
    get_project_revision_file: [{ ...revision, path }],
    get_project_revision_jobs: [revision],
    create_project: [{ displayName }],
    rename_project: [{ projectId, displayName }],
    delete_project: [project],
    attach_project_revision: [
      { projectId, sourceId, displayName, originalFilename: path },
    ],
    update_project_file: [{ ...revision, file }],
    delete_project_file: [{ ...revision, path }],
    render_project_revision: [revision],
  } satisfies Record<string, Record<string, unknown>[]>;
}

describe("public gateway wire", () => {
  it("executes all reference and null combinations for both adoption IDs and rejects either omission", async () => {
    await using fixture = await rendererFixture();
    const { gateway } = fixture;
    const name = "adopt_project_revision";
    const {
      result: { tools },
    } = await gateway.catalog();
    const tool = tools.find((entry) => entry.name === name);
    if (!tool) throw new Error("Missing adoption tool");
    const validate = new Ajv2020().compile(tool.inputSchema);
    const project = await gateway.call("create_project", {
      displayName: "Adoption fixture",
    });
    const projectId = returnedReference(project, "project");
    const source = await gateway.call("create_source", {
      files: [{ path: "main.tex", text: "Adoption fixture" }],
    });
    const sourceId = returnedReference(source, "source");
    const attached = await gateway.call("attach_project_revision", {
      projectId,
      sourceId,
      displayName: "First revision",
      originalFilename: "main.tex",
    });
    const revisionId = returnedReference(attached, "revision");
    for (const [next, expected] of [
      [null, null],
      [revisionId, null],
      [revisionId, revisionId],
      [null, revisionId],
    ]) {
      const args = {
        projectId,
        revisionId: next,
        expectedRevisionId: expected,
      };
      expect(validate(args)).toBe(true);
      const reply = await gateway.call(name, args);
      expect(reply.result.structuredContent).toMatchObject({
        success: true,
        result: {
          adoptedRevisionId:
            next === null
              ? null
              : (expect.stringMatching(/^lrref_/) as unknown),
        },
      });
      const adopted = reply.result.structuredContent.result?.adoptedRevisionId;
      if (typeof adopted === "string")
        expect(gateway.open(adopted)).toBe(gateway.open(revisionId));
    }
    for (const args of [
      { projectId, revisionId: null },
      { projectId, expectedRevisionId: null },
    ]) {
      expect(validate(args)).toBe(false);
      gateway.forward.mockClear();
      expect(
        (await gateway.call(name, args)).result.structuredContent.error,
      ).toEqual({ code: "invalid_operation" });
      expect(gateway.forward).not.toHaveBeenCalled();
    }
  });

  it("recovers a real conditions conflict and upload offset using the direct and public reply fields", async () => {
    await using fixture = await rendererFixture();
    const { gateway, direct, renders, userId } = fixture;
    const identity = { userId, scopes: ["mcp:read", "mcp:render"] as const };
    const { id } = renders.createProject(identity, "Conditions fixture");
    const projectId = gateway.seal(id);
    const name = "update_project_document_conditions";
    const conditions = {
      expectedVersion: 0,
      entries: [
        { kind: "preserve", basis: "user_specified", text: "Keep math fonts" },
      ],
    };
    expect(
      (await direct(name, { projectId: id, ...conditions })).result
        .structuredContent,
    ).toMatchObject({ result: { version: 1 } });
    const directConflict = await direct(name, { projectId: id, ...conditions });
    const publicConflict = await gateway.call(name, {
      projectId,
      ...conditions,
    });
    const versionError = {
      code: "DOCUMENT_CONDITIONS_CONFLICT",
      currentVersion: 1,
    };
    expect(directConflict.result.structuredContent.error).toMatchObject(
      versionError,
    );
    expect(directConflict.result.content[0]?.text).toContain(
      "Current version: 1",
    );
    expect(publicConflict.result.structuredContent.error).toEqual(versionError);
    const { currentVersion } = JSON.parse(
      publicConflict.result.content[0]?.text ?? "null",
    ) as { currentVersion: number };
    expect(
      (
        await gateway.call(name, {
          projectId,
          expectedVersion: currentVersion,
          entries: [],
        })
      ).result.structuredContent,
    ).toMatchObject({ result: { version: 2, entries: [] } });

    const bytes = Buffer.from("ABCDEFGH");
    const upload = await renders.beginSourceUpload(
      identity,
      bytes.length,
      createHash("sha256").update(bytes).digest("hex"),
    );
    const uploadId = gateway.seal(upload.uploadId);
    const uploadTool = "upload_source_chunk";
    const chunk = {
      offset: 0,
      base64: bytes.subarray(0, 4).toString("base64"),
    };
    expect(
      (await gateway.call(uploadTool, { uploadId, ...chunk })).result
        .structuredContent,
    ).toMatchObject({ result: { upload: { receivedBytes: 4 } } });
    const next = { offset: 0, base64: bytes.subarray(4).toString("base64") };
    const offsetError = { code: "SOURCE_UPLOAD_OFFSET", expectedOffset: 4 };
    const directMismatch = await direct(uploadTool, {
      uploadId: upload.uploadId,
      ...next,
    });
    const publicMismatch = await gateway.call(uploadTool, {
      uploadId,
      ...next,
    });
    expect(directMismatch.result.structuredContent.error).toMatchObject(
      offsetError,
    );
    expect(directMismatch.result.content[0]?.text).toContain(
      "Resume at byte 4",
    );
    expect(publicMismatch.result.structuredContent.error).toEqual(offsetError);
    const { expectedOffset } = JSON.parse(
      publicMismatch.result.content[0]?.text ?? "null",
    ) as { expectedOffset: number };
    expect(
      (
        await gateway.call(uploadTool, {
          ...next,
          uploadId,
          offset: expectedOffset,
        })
      ).result.structuredContent,
    ).toMatchObject({ result: { upload: { receivedBytes: 8 } } });
  });

  it("keeps preview retryability and rate-limit backoff in both MCP reply forms", async () => {
    await using fixture = await rendererFixture();
    const { gateway, direct, database, renders, userId } = fixture;
    const identity = { userId, scopes: ["mcp:read", "mcp:render"] as const };
    vi.setSystemTime(new Date());
    try {
      const now = Date.now();
      const timestamp = new Date(now).toISOString();
      const job = await renders.createRender(identity, {
        inlineSource: "Preview fixture",
      });
      database.raw
        .prepare(
          "UPDATE jobs SET status='succeeded', completed_at=? WHERE id=?",
        )
        .run(timestamp, job.id);
      const artifactId = `artifact_${"a".repeat(32)}`;
      const pdfSha256 = createHash("sha256").update(pdf).digest("hex");
      database.artifacts.insert({
        id: artifactId,
        job_id: job.id,
        type: "pdf",
        relative_path: "result.pdf",
        size: pdf.length,
        sha256: pdfSha256,
        created_at: timestamp,
      });
      database.previews.register({
        job_id: job.id,
        pdf_artifact_id: artifactId,
        pdf_sha256: pdfSha256,
        page_count: 1,
        runtime_image: "renderer:test",
        created_at: timestamp,
      });
      database.previews.request(job.id, 1, timestamp);
      const preview = database.previews.claim("worker", timestamp);
      if (!preview) throw new Error("Missing queued preview");
      expect(
        database.previews.finish(
          preview,
          "worker",
          timestamp,
          "PREVIEW_CONVERSION_FAILED",
        ),
      ).toBe(true);

      const reference = gateway.seal(job.id);
      const directFailure = await direct("get_render_preview", {
        jobId: job.id,
        page: 1,
      });
      const publicFailure = await gateway.call("get_render_preview", {
        jobId: reference,
        page: 1,
      });
      const previewError = {
        code: "PREVIEW_FAILED",
        previewErrorCode: "PREVIEW_CONVERSION_FAILED",
        retryable: true,
      };
      expect(directFailure.result.structuredContent.error).toMatchObject(
        previewError,
      );
      expect(directFailure.result.content[0]?.text).toContain(
        "Retryable: true",
      );
      expect(publicFailure.result.structuredContent.error).toEqual(
        previewError,
      );
      expect(
        JSON.parse(publicFailure.result.content[0]?.text ?? "null") as unknown,
      ).toEqual(previewError);

      const tool = "get_render_status";
      for (let i = 0; i < 60; i++) renders.enforceRateLimit(userId, tool, 60);
      const directLimited = await direct(tool, { jobId: job.id });
      const publicLimited = await gateway.call(tool, { jobId: reference });
      const rateError = {
        code: "REMOTE_MCP_RATE_LIMIT",
        retryAfterSeconds: 60,
      };
      expect(directLimited.result.structuredContent.error).toMatchObject(
        rateError,
      );
      expect(directLimited.result.content[0]?.text).toMatch(/Retry after.*60/i);
      expect(publicLimited.result.structuredContent.error).toEqual(rateError);
      const { retryAfterSeconds } = JSON.parse(
        publicLimited.result.content[0]?.text ?? "null",
      ) as { retryAfterSeconds: number };
      expect(retryAfterSeconds).toBe(60);
      vi.setSystemTime(now + retryAfterSeconds * 1000);
      expect(
        (await gateway.call(tool, { jobId: reference })).result
          .structuredContent,
      ).toMatchObject({ success: true });
      expect(
        (
          await gateway.call("get_render_preview_pages", {
            jobId: reference,
            pdfSha256,
            pages: [1],
          })
        ).result.structuredContent,
      ).toMatchObject({
        success: true,
        result: { pages: [{ page: 1, state: "pending" }] },
      });
      expect(database.previews.get(job.id, 1)?.status).toBe("queued");
    } finally {
      vi.useRealTimers();
    }
  });
  it("accepts a shared wire input fixture for every published tool at the dispatch boundary", async () => {
    const store = new SqliteConnectionStore(":memory:");
    try {
      const fixture = catalogFixture(store);
      const { result } = await fixture.catalog();
      const inputs: Record<string, Record<string, unknown>[]> = catalogInputs(
        fixture.seal,
      );
      expect(assertCompleteWireCatalog(result).toolCount).toBe(
        Object.keys(inputs).length,
      );
      expect(result.tools.map(({ name }) => name).sort()).toEqual(
        Object.keys(inputs).sort(),
      );
      const ajv = new Ajv2020({ strictSchema: true, strictTypes: false });
      addFormats.default(ajv);
      for (const { name, inputSchema } of result.tools) {
        const validate = ajv.compile(inputSchema);
        for (const args of inputs[name] ?? []) {
          fixture.forward.mockClear();
          expect(
            validate(args),
            `${name}: ${ajv.errorsText(validate.errors)}`,
          ).toBe(true);
          const reply = await fixture.call(name, args);
          if (name === "get_profile") {
            expect(reply).toMatchObject({
              result: { structuredContent: { id: fixture.auth.profileId } },
            });
            expect(fixture.forward).not.toHaveBeenCalled();
          } else {
            expect(reply, name).toMatchObject({
              result: { structuredContent: { success: true } },
            });
            expect(fixture.forward).toHaveBeenCalledExactlyOnceWith(
              expect.objectContaining({
                operation: expect.objectContaining({
                  name,
                  method: "tools/call",
                }) as unknown,
              }),
            );
            fixture.forward.mockClear();
            const extra = { ...args, unexpectedField: true };
            expect(validate(extra), name).toBe(false);
            expect(await fixture.call(name, extra), name).toMatchObject({
              result: {
                structuredContent: { error: { code: "invalid_operation" } },
              },
            });
            expect(fixture.forward).not.toHaveBeenCalled();
          }
        }
      }
    } finally {
      store.close();
    }
  });

  it("opens nested and array references only for the bound installation", async () => {
    const store = new SqliteConnectionStore(":memory:");
    try {
      const fixture = catalogFixture(store);
      const inputs = catalogInputs(fixture.seal);
      const [nested] = inputs.check_document_requirements;
      const [array] = inputs.plan_project_revision_cleanup;
      const projectId = `project_${"a".repeat(32)}`;
      const revisionId = `revision_${"b".repeat(32)}`;
      for (const [name, input, decoded, malformed] of [
        [
          "check_document_requirements",
          nested,
          { revision: { projectId, revisionId } },
          {
            ...nested,
            revision: { ...nested?.revision, revisionId: "lrref_invalid" },
          },
        ],
        [
          "plan_project_revision_cleanup",
          array,
          { projectId, revisionIds: [revisionId] },
          { ...array, revisionIds: ["lrref_invalid"] },
        ],
      ] as const) {
        if (!input) throw new Error(`Missing catalog fixture for ${name}`);
        await fixture.call(name, input);
        expect(fixture.forward.mock.lastCall?.[0].operation).toMatchObject({
          name,
          arguments: decoded,
        });
        fixture.forward.mockClear();
        for (const [args, foreign] of [
          [input, true],
          [malformed, false],
        ] as const)
          expect(await fixture.call(name, args, foreign)).toMatchObject({
            result: {
              structuredContent: { error: { code: "invalid_reference" } },
            },
          });
        expect(fixture.forward).not.toHaveBeenCalled();
      }
    } finally {
      store.close();
    }
  });

  // The profile fast path returns before the shared argument validator.
  it.fails(
    "rejects get_profile arguments that its published schema forbids",
    async () => {
      const store = new SqliteConnectionStore(":memory:");
      try {
        const fixture = catalogFixture(store);
        const {
          result: { tools },
        } = await fixture.catalog();
        const tool = tools.find(({ name }) => name === "get_profile");
        if (!tool) throw new Error("Missing get_profile");
        const args = { unexpectedField: true };
        expect(new Ajv2020().compile(tool.inputSchema)(args)).toBe(false);
        expect(
          (await fixture.call(tool.name, args)).result.structuredContent.error,
        ).toEqual({ code: "invalid_operation" });
      } finally {
        store.close();
      }
    },
  );

  // Public JSON Schema serialization currently drops these Zod refinements.
  it.fails.each([
    ["create_render", () => ({})],
    ["create_source", () => ({ files: [{ path: "main.tex" }] })],
    ["read_render_log", (args) => ({ ...args, startByte: 0, startLine: 1 })],
    ["check_document_requirements", () => ({ engine: "lualatex" })],
    [
      "open_project_draft",
      ({ projectId }) => ({ projectId, replaceVersion: 1 }),
    ],
    [
      "attach_project_revision",
      (args) => ({ ...args, originalFilename: "folder/main.tex" }),
    ],
  ] satisfies [
    keyof ReturnType<typeof catalogInputs>,
    (args: Record<string, unknown>) => Record<string, unknown>,
  ][])(
    "advertises the input constraints enforced by %s",
    async (name, invalidInput) => {
      const store = new SqliteConnectionStore(":memory:");
      try {
        const fixture = catalogFixture(store);
        const {
          result: { tools },
        } = await fixture.catalog();
        const tool = tools.find((entry) => entry.name === name);
        const [valid] = catalogInputs(fixture.seal)[name];
        if (!tool || !valid) throw new Error(`Missing fixture for ${name}`);
        const args = invalidInput(valid);
        expect(
          (await fixture.call(name, args)).result.structuredContent.error,
        ).toEqual({ code: "invalid_operation" });
        expect(fixture.forward).not.toHaveBeenCalled();
        const ajv = new Ajv2020();
        addFormats.default(ajv);
        expect(ajv.compile(tool.inputSchema)(args)).toBe(false);
      } finally {
        store.close();
      }
    },
  );

  it("serves the tool catalog, binds references to the installation, and omits lower download URLs", async () => {
    const store = new SqliteConnectionStore(":memory:");
    try {
      const { auth } = authorization(store, "https");
      const { auth: other } = authorization(store, "agent");
      const tokens = new GatewayOAuthTokens(origin, store.oauth, key, 300_000);
      const token = publicGatewayBearer(tokens, auth),
        otherToken = publicGatewayBearer(tokens, other);
      const https = vi.fn<() => Promise<unknown>>(async () =>
        Promise.resolve({
          result: {
            structuredContent: {
              success: true,
              result: {
                job: {
                  id: jobId,
                  webResultUrl: "https://private.example.com/result",
                  artifacts: [
                    { relativePath: target.path, sha256: target.sha256 },
                  ],
                },
              },
            },
          },
        }),
      );
      const agent = vi.fn(async () =>
        Promise.reject(new Error("unexpected agent dispatch")),
      );
      const references = new RelayReferences(key);
      const mcp = createPublicMcp({
        version: "test",
        tokens,
        dispatch: new RendererDispatch(store, { https, agent }, 2),
        references,
        maxRequestBytes: 1024 * 1024,
        maxSourceBytes: 20 * 1024 * 1024,
        transport: (id) => store.transport(id),
        download: (_owner, file) =>
          file.sha256 === target.sha256
            ? `${origin}/downloads/opaque`
            : undefined,
      });
      const request = (method: string, params: unknown, access: string) =>
        mcp(
          new Request(`${origin}/mcp`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${access}`,
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
            },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          }),
        );
      const catalogResponse = await request("tools/list", {}, token);
      const catalogText = await catalogResponse?.text();
      const data =
        catalogText
          ?.split(/\r?\n/)
          .find((line) => line.startsWith("data: "))
          ?.slice(6) ?? catalogText;
      const catalog = JSON.parse(data ?? "null") as {
        result: { tools: { name: string; inputSchema: unknown }[] };
      };
      expect(catalog).toMatchObject({
        result: {
          tools: expect.arrayContaining([
            expect.objectContaining({ name: "get_authoring_guide" }),
            expect.objectContaining({ name: "apply_project_changes" }),
            expect.objectContaining({ name: "get_render_quality_report" }),
          ]) as unknown,
        },
      });
      const adoption = catalog.result.tools.find(
        ({ name }) => name === "adopt_project_revision",
      );
      expect(adoption?.inputSchema).toMatchObject({
        properties: {
          revisionId: {
            anyOf: [
              { type: "string", pattern: "^lrref_[A-Za-z0-9_-]+$" },
              { type: "null" },
            ],
          },
          expectedRevisionId: {
            anyOf: [
              { type: "string", pattern: "^lrref_[A-Za-z0-9_-]+$" },
              { type: "null" },
            ],
          },
        },
      });
      const protectedId = references.seal(auth, "object", jobId);
      const result = await request(
        "tools/call",
        { name: "get_render_artifacts", arguments: { jobId: protectedId } },
        token,
      );
      const wire = await result?.text();
      expect(wire).toContain(`${origin}/downloads/opaque`);
      expect(wire).not.toContain(jobId);
      expect(wire).not.toContain("private.example.com");
      expect(https).toHaveBeenCalledOnce();
      const denied = await request(
        "tools/call",
        { name: "get_render_artifacts", arguments: { jobId: protectedId } },
        otherToken,
      );
      expect(await denied?.text()).toContain("invalid_reference");
      expect(agent).not.toHaveBeenCalled();

      https.mockResolvedValueOnce({
        result: {
          isError: true,
          structuredContent: {
            success: false,
            error: {
              code: "SOURCE_UPLOAD_OFFSET",
              expectedOffset: 512,
              retryAfterSeconds: 3,
              message: "/private/renderer/source",
            },
          },
        },
      });
      const failed = await request(
        "tools/call",
        { name: "get_render_artifacts", arguments: { jobId: protectedId } },
        token,
      );
      const failure = await failed?.text();
      expect(failure).toContain('"expectedOffset":512');
      expect(failure).toContain('"retryAfterSeconds":3');
      expect(failure).not.toContain("/private/renderer/source");
    } finally {
      store.close();
    }
  });

  it("serves range requests and rejects expired or revoked download URLs", async () => {
    const store = new SqliteConnectionStore(":memory:");
    try {
      const { auth } = authorization(store, "agent");
      let now = Date.now();
      const downloads = createDownloads({
        origin,
        store,
        references: new RelayReferences(key),
        capacity: 2,
        maxBytes: 1024,
        clock: () => now,
        pull: async (_authorization, _transport, request) =>
          Promise.resolve({
            sha256: target.sha256,
            mimeType: "application/pdf",
            size: pdf.length,
            offset: request.offset,
            data: pdf
              .subarray(request.offset, request.offset + request.limit)
              .toString("base64"),
          }),
      });
      const url = downloads.link(auth, target) ?? "";
      const partial = await downloads.handle(
        new Request(url, { headers: { Range: "bytes=0-3" } }),
      );
      expect(partial?.status).toBe(206);
      expect(partial?.headers.get("Content-Range")).toBe(
        `bytes 0-3/${pdf.length}`,
      );
      expect(await partial?.text()).toBe("%PDF");
      expect(
        (
          await downloads.handle(
            new Request(url, { headers: { Range: "bytes=100-" } }),
          )
        )?.status,
      ).toBe(416);
      expect(
        (
          await downloads.handle(new Request(url, { method: "HEAD" }))
        )?.headers.get("ETag"),
      ).toBe(`"sha256-${target.sha256}"`);
      now += 600_001;
      expect((await downloads.handle(new Request(url)))?.status).toBe(410);
      const refreshed = downloads.link(auth, target) ?? "";
      store.revokeAuthorization(auth.id, now);
      expect((await downloads.handle(new Request(refreshed)))?.status).toBe(
        404,
      );
    } finally {
      store.close();
    }
  });

  it("authenticates both real socket channels and keeps control available after file disconnect", async () => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No HTTP test listener");
    const authority = `127.0.0.1:${address.port}`,
      gatewayOrigin = `https://${authority}`;
    const store = new SqliteConnectionStore(":memory:");
    const { keys, auth, transport } = authorization(store, "agent");
    const sockets = createGatewayAgentSockets({
      origin: gatewayOrigin,
      store,
      pairing: new GatewayAgentPairing(store.agentPairing, key, {
        perTransport: 2,
        perInstance: 2,
        total: 5,
      }),
      maxFrameBytes: 2_000_000,
      capacity: 2,
      maxSockets: 8,
      timeoutMs: 1000,
      heartbeatMs: 500,
    });
    sockets.listen(server);
    async function connect(
      channel: "control" | "files",
      generation: string | null,
    ) {
      const ws = new WebSocket(
        `ws://${authority}${rendererRelayAgentPaths[channel]}`,
      );
      const execute = vi.fn((method: string) =>
        Promise.resolve(
          method === "renderer.revoke" ? { revoked: true } : { channel },
        ),
      );
      const rpc = new RelayRpc(
        (frame) => ws.send(frame),
        2_000_000,
        2,
        execute,
      );
      let handshake = 0;
      const verified = new Promise<string>((resolve, reject) => {
        ws.addEventListener(
          "close",
          () => {
            rpc.close();
            reject(new Error("Connection closed"));
          },
          { once: true },
        );
        ws.addEventListener("message", (event: MessageEvent<unknown>) => {
          if (typeof event.data !== "string") return;
          if (handshake === 2) {
            void rpc.receive(event.data).catch(reject);
            return;
          }
          const frame = JSON.parse(event.data) as {
            nonce: string;
            generation: string;
          };
          if (handshake++ === 1) {
            resolve(frame.generation);
            return;
          }
          const proof = {
            version: rendererRelayVersion,
            instanceId: keys.instanceId,
            transportId: transport.id,
            generation,
          } as const;
          const signature = sign(
            null,
            Buffer.from(
              rendererRelaySocketMessage(
                gatewayOrigin,
                channel,
                frame.nonce,
                proof,
              ),
            ),
            keys.agentPrivateKey,
          ).toString("base64url");
          ws.send(JSON.stringify({ ...proof, signature }));
        });
      });
      return { ws, execute, generation: await verified };
    }
    try {
      const control = await connect("control", null);
      const file = await connect("files", control.generation);
      const read = {
        method: "tools/call",
        name: "get_render_status",
        arguments: { jobId },
      } as const;
      const request = {
        authorization: auth,
        transport,
        signal: new AbortController().signal,
      };
      expect(await sockets.dispatch({ ...request, operation: read })).toEqual({
        channel: "files",
      });
      const closed = new Promise<void>((resolve) =>
        file.ws.addEventListener("close", () => resolve(), { once: true }),
      );
      file.ws.close();
      await closed;
      await expect(
        sockets.dispatch({ ...request, operation: read }),
      ).rejects.toMatchObject({ code: "connection_offline" });
      const resumed = await connect("files", control.generation);
      expect(await sockets.dispatch({ ...request, operation: read })).toEqual({
        channel: "files",
      });
      resumed.ws.close();
      const controlClosed = new Promise<void>((resolve) =>
        control.ws.addEventListener("close", () => resolve(), { once: true }),
      );
      control.ws.close();
      await controlClosed;
      expect(store.disconnect(auth.id, Date.now(), false)).toBe(true);
      expect(store.disconnect(auth.id, Date.now(), true)).toBe(true);
      expect(store.authorization(auth.id)).toBeUndefined();
      expect(store.pendingAgentRevocations(transport.id, Date.now())).toEqual([
        auth.localGrantId,
      ]);
      const reconnected = await connect("control", null);
      await vi.waitFor(() => {
        expect(reconnected.execute).toHaveBeenCalledWith("renderer.revoke", {
          grant: auth.localGrantId,
        });
        expect(store.pendingAgentRevocations(transport.id, Date.now())).toEqual(
          [],
        );
      });
      reconnected.ws.close();
    } finally {
      sockets.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    }
  });
});
