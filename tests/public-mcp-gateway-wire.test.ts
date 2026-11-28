import { createHash, createPublicKey, sign } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import {
  rendererRelayAgentPaths,
  rendererRelaySocketMessage,
  rendererRelayVersion,
  type RendererRelayDownloadTarget,
} from "../packages/contracts/src/index.js";
import { RelayRpc } from "../packages/shared/src/relay-rpc.js";
import { createAgentEnrollmentKeys } from "../apps/public-mcp-agent/src/enrollment.js";
import { zipStoredFiles } from "../apps/admin-web/src/assets/render-script.js";
import { createRemoteMcpHandler } from "../apps/remote-mcp/src/mcp.js";
import { createGatewayAgentSockets } from "../apps/public-mcp-gateway/src/agent-sockets.js";
import { GatewayAgentPairing } from "../apps/public-mcp-gateway/src/agent-pairing.js";
import { createDownloads } from "../apps/public-mcp-gateway/src/downloads.js";
import {
  authorizationLifetimeMs,
  GatewayOAuthTokens,
  validateOAuthAuthorizationRequest,
} from "../apps/public-mcp-gateway/src/oauth-tokens.js";
import { createPublicMcp } from "../apps/public-mcp-gateway/src/public-mcp.js";
import { RelayReferences } from "../apps/public-mcp-gateway/src/relay-references.js";
import {
  RendererDispatch,
  type DispatchTransport,
} from "../apps/public-mcp-gateway/src/renderer-dispatch.js";
import { SqliteConnectionStore } from "../apps/public-mcp-gateway/src/sqlite-connections.js";
import type { ConnectionAuthorization } from "../apps/public-mcp-gateway/src/connections.js";
import { RemoteRenderService } from "../packages/remote-mcp-core/src/index.js";
import { sourceLimitFiles } from "./helpers/source-limit-files.js";

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
  offset = 0,
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
  const auth = store.createAuthorization(
    {
      profileId: profile.id,
      transportId: transport.id,
      localGrantId: "local-grant",
      scopes: ["mcp:read", "mcp:render"],
      expiresAt: Date.now() + authorizationLifetimeMs + offset,
    },
    Date.now(),
    kind === "https" ? () => "fixture-opaque-credentials" : undefined,
  );
  return { keys, auth, transport };
}

function bearer(tokens: GatewayOAuthTokens, auth: ConnectionAuthorization) {
  const redirect = "https://client.example.com/callback",
    verifier = "a".repeat(43),
    client = "test-client";
  const query = new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    resource: tokens.resource,
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const request = validateOAuthAuthorizationRequest(
    query,
    { id: client, redirectUris: [redirect] },
    tokens.resource,
  );
  const consent = tokens.beginConsent(request, {
    lifetimeMs: 60_000,
    capacity: 5,
  });
  const callback = tokens.completeConsent(
    consent,
    request,
    auth.id,
    auth.scopes,
  );
  return tokens.exchangeCode(
    client,
    new URLSearchParams({
      code: callback.searchParams.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: redirect,
      resource: tokens.resource,
    }),
  ).access_token;
}

describe("public gateway wire", () => {
  it("preserves selected Renderer capabilities and enforces the distinct public upload ceiling", async () => {
    const store = new SqliteConnectionStore(":memory:");
    const db = new RendererDatabase(":memory:");
    const root = await mkdtemp(join(tmpdir(), "public-mcp-limits-"));
    try {
      db.migrate();
      db.users.insertInvitation({
        id: "local-user",
        displayName: "Fixture",
        role: "user",
        createdBy: "test",
        timestamp: new Date().toISOString(),
      });
      const { auth } = authorization(store, "https");
      const tokens = new GatewayOAuthTokens(origin, store.oauth, key, 300_000);
      const token = bearer(tokens, auth);
      const publicMaxBytes = 1024 ** 2;
      const instanceMaxBytes = 24 * 1024 ** 2;
      const lowerOrigin = "https://renderer.example.com";
      const service = new RemoteRenderService(
        db,
        root,
        "test",
        lowerOrigin,
        10,
        64 * 1024 ** 2,
        join(root, "environment"),
        {
          maxUploadBytes: instanceMaxBytes,
          maxExtractedBytes: 30 * 1024 ** 2,
          maxFileCount: 501,
          maxZipEntries: 600,
        },
      );
      const renderer = createRemoteMcpHandler(service, "test");
      const readRpc = async (
        response: Response | undefined,
      ): Promise<unknown> => {
        if (!response?.ok) throw new Error("Expected an MCP response");
        const text = await response.text();
        const payload = text
          .split(/\r?\n/)
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
        return JSON.parse(payload ?? text) as unknown;
      };
      const request = (
        base: string,
        name: string,
        args: object,
        access: string,
      ) =>
        new Request(`${base}/mcp`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
            Accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name, arguments: args },
          }),
        });
      const direct = async (name: string, args: object): Promise<unknown> => {
        const response = await renderer.fetch(
          request(lowerOrigin, name, args, "fixture"),
          {
            authInfo: {
              token: "fixture",
              clientId: "fixture",
              scopes: ["mcp:read", "mcp:render"],
              extra: { userId: "local-user" },
            },
          },
        );
        return readRpc(response);
      };
      const https = vi.fn<DispatchTransport>(async ({ operation }) => {
        if (operation.method !== "tools/call")
          throw new Error("Expected a tool call");
        return direct(operation.name, operation.arguments);
      });
      const mcp = createPublicMcp({
        version: "test",
        tokens,
        dispatch: new RendererDispatch(store, { https, agent: https }, 2),
        references: new RelayReferences(key),
        maxRequestBytes: 1024 ** 2,
        maxSourceBytes: publicMaxBytes,
        transport: (id) => store.transport(id),
      });
      const gateway = async (name: string, args: object): Promise<unknown> => {
        return readRpc(await mcp(request(origin, name, args, token)));
      };
      const capabilities = await direct("get_renderer_capabilities", {});
      const sourceLimits = {
        inlineBytes: 64 * 1024,
        directBytes: 4 * 1024 ** 2,
        directFiles: 100,
        directFileBytes: 1024 ** 2,
        uploadBytes: instanceMaxBytes,
        files: 501,
        fileBytes: instanceMaxBytes,
        chunkBytes: 512 * 1024,
      };
      const limitsResult = {
        result: {
          structuredContent: { result: { capabilities: { sourceLimits } } },
        },
      };
      expect(capabilities).toMatchObject(limitsResult);
      expect(await gateway("get_renderer_capabilities", {})).toMatchObject(
        limitsResult,
      );
      const accepted = { result: { structuredContent: { success: true } } };
      const files = sourceLimitFiles(101);
      expect(
        await gateway("create_source", { files: files.slice(0, 100) }),
      ).toMatchObject(accepted);
      expect(await direct("create_source", { files })).not.toMatchObject(
        accepted,
      );
      expect(await gateway("create_source", { files })).toMatchObject({
        result: {
          structuredContent: {
            success: false,
            error: { code: "invalid_operation" },
          },
        },
      });

      const uploadZip = async (count: number) => {
        const archive = Buffer.from(
          zipStoredFiles(
            sourceLimitFiles(count).map(({ path, text }) => ({
              name: path,
              bytes: Buffer.from(text),
            })),
            count,
          ),
        );
        const sha256 = createHash("sha256").update(archive).digest("hex");
        const reservation = (await gateway("begin_source_upload", {
          expectedBytes: archive.length,
          sha256,
        })) as {
          result: {
            structuredContent: { result: { upload: { uploadId: string } } };
          };
        };
        const { uploadId } = reservation.result.structuredContent.result.upload;
        expect(uploadId).toMatch(/^lrref_/);
        expect(
          await gateway("upload_source_chunk", {
            uploadId,
            offset: 0,
            base64: archive.toString("base64"),
          }),
        ).toMatchObject(accepted);
        return {
          sha256,
          result: await gateway("finalize_source_upload", { uploadId }),
        };
      };
      const withinLimit = await uploadZip(sourceLimits.files);
      expect(withinLimit.result).toMatchObject({
        result: {
          structuredContent: {
            success: true,
            result: { source: { status: "ready" } },
          },
        },
      });
      const overLimit = await uploadZip(sourceLimits.files + 1);
      expect(overLimit.result).toMatchObject({
        result: {
          structuredContent: {
            success: false,
            error: { code: "ZIP_TOO_MANY_FILES" },
          },
        },
      });
      expect(
        db.raw
          .prepare(
            "SELECT status, upload_lease_owner FROM sources WHERE sha256=?",
          )
          .get(overLimit.sha256),
      ).toEqual({
        status: "uploading",
        upload_lease_owner: null,
      });
      expect(db.raw.prepare("SELECT COUNT(*) AS n FROM jobs").get()).toEqual({
        n: 0,
      });

      const beforeDenied = https.mock.calls.length;
      const upload = {
        expectedBytes: publicMaxBytes + 1,
        sha256: "f".repeat(64),
      };
      expect(await gateway("begin_source_upload", upload)).toMatchObject({
        result: {
          structuredContent: {
            success: false,
            error: { code: "invalid_operation" },
          },
        },
      });
      expect(https).toHaveBeenCalledTimes(beforeDenied);
      expect(await direct("begin_source_upload", upload)).toMatchObject(
        accepted,
      );
    } finally {
      db.close();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("serves the tool catalog, binds references to the installation, and omits lower download URLs", async () => {
    const store = new SqliteConnectionStore(":memory:");
    try {
      const { auth } = authorization(store, "https");
      const { auth: other } = authorization(store, "agent");
      const tokens = new GatewayOAuthTokens(origin, store.oauth, key, 300_000);
      const token = bearer(tokens, auth),
        otherToken = bearer(tokens, other);
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
