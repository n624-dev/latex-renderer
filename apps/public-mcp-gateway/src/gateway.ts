import { createAdaptorServer } from "@hono/node-server";
import { Server } from "node:http";
import { createAgentEnrollmentHandler } from "./agent-enrollment-http.js";
import { GatewayAgentEnrollment } from "./agent-enrollment.js";
import { GatewayAgentPairing } from "./agent-pairing.js";
import { createGatewayAgentSockets } from "./agent-sockets.js";
import { createBrowserConsent } from "./browser-consent.js";
import { createDownloads } from "./downloads.js";
import { HttpsCredentialKeys } from "./https-credential-keys.js";
import { createHttpsDispatch } from "./https-dispatch.js";
import { type CimdClientTrust } from "./oauth-clients.js";
import { createGatewayOAuthHandler } from "./oauth-http.js";
import { GatewayOAuthTokens } from "./oauth-tokens.js";
import { createPublicMcp } from "./public-mcp.js";
import { RelayReferences } from "./relay-references.js";
import { RendererDispatch } from "./renderer-dispatch.js";
import type { SqliteConnectionStore } from "./sqlite-connections.js";

export interface GatewayLimits {
  pending: number;
  maxBodyBytes: number;
  maxSourceBytes: number;
  maxResponseBytes: number;
  maxDownloadBytes: number;
  maxSockets: number;
  concurrency: number;
  registrations: number;
  attempts: { perTransport: number; perInstance: number; total: number };
  timeoutMs: number;
}

type CleanupStatus = { startedAt: string } & (
  | ({ status: "ok"; dcrRegistrationCapacityRemaining: number } & ReturnType<
      SqliteConnectionStore["pruneExpiredCredentials"]
    >)
  | { status: "failed" }
);

export function createGateway(options: {
  store: SqliteConnectionStore;
  origin: string;
  version: string;
  limits: GatewayLimits;
  secrets: {
    refresh: Uint8Array;
    pairing: Uint8Array;
    references: Uint8Array;
    https: HttpsCredentialKeys;
  };
  dcrRedirectUris: ReadonlySet<string>;
  cimdClients: ReadonlyMap<string, CimdClientTrust>;
  allowRegistration: (request: Request) => boolean;
}) {
  const { origin, store, secrets, limits } = options;
  const tokens = new GatewayOAuthTokens(
    origin,
    store.oauth,
    secrets.refresh,
    300_000,
  );
  const pairing = new GatewayAgentPairing(
    store.agentPairing,
    secrets.pairing,
    limits.attempts,
  );
  const agent = createGatewayAgentSockets({
    origin,
    store,
    pairing,
    maxFrameBytes: limits.maxResponseBytes,
    capacity: limits.concurrency,
    timeoutMs: limits.timeoutMs,
    heartbeatMs: 30_000,
    maxSockets: limits.maxSockets,
  });
  const https = createHttpsDispatch({
    store,
    keys: secrets.https,
    maxResponseBytes: limits.maxResponseBytes,
    timeoutMs: limits.timeoutMs,
  });
  const dispatch = new RendererDispatch(
    store,
    { https: (input) => https.dispatch(input), agent: agent.dispatch },
    limits.concurrency,
  );
  const references = new RelayReferences(secrets.references);
  const browser = createBrowserConsent({
    tokens,
    pairing,
    store,
    keys: secrets.https,
    references,
    capacity: limits.pending,
    timeoutMs: limits.timeoutMs,
    maxMetadataBytes: limits.maxBodyBytes,
    revokeHttps: (id, mcpUrl) => https.revoke(id, mcpUrl),
    agentOnline: (id) => agent.online(id),
    deliverAgentRevocations: agent.deliverRevocations,
  });
  const oauth = createGatewayOAuthHandler({
    tokens,
    clients: store,
    dcrRedirectUris: options.dcrRedirectUris,
    cimdClients: options.cimdClients,
    dcrCapacity: limits.registrations,
    maxBodyBytes: limits.maxBodyBytes,
    maxMetadataBytes: limits.maxBodyBytes,
    networkTimeoutMs: limits.timeoutMs,
    assertionLifetimeSeconds: 300,
    allowRegistration: options.allowRegistration,
    claimAssertion: (hash, expiry, now) =>
      store.claimClientAssertion(hash, expiry, now),
    showConsent: browser.showConsent,
    submitConsent: browser.submitConsent,
  });
  const enrollment = createAgentEnrollmentHandler({
    enrollment: new GatewayAgentEnrollment(origin, store, {
      lifetimeMs: 300_000,
      pending: limits.pending,
      registrations: limits.registrations,
    }),
    maximumProofBytes: limits.maxBodyBytes,
    allowEnrollment: options.allowRegistration,
  });
  const downloads = createDownloads({
    origin,
    references,
    store,
    maxBytes: limits.maxDownloadBytes,
    capacity: limits.concurrency,
    pull: (authorization, transport, input, signal) =>
      transport.endpoint.kind === "https"
        ? https.download(
            authorization.id,
            transport.endpoint.mcpUrl,
            input,
            signal,
          )
        : agent.download(transport.id, input, signal),
  });
  const mcp = createPublicMcp({
    version: options.version,
    tokens,
    dispatch,
    references,
    maxRequestBytes: limits.maxBodyBytes,
    maxSourceBytes: limits.maxSourceBytes,
    transport: (id) => store.transport(id),
    download: downloads.link,
  });

  let lastCleanup: CleanupStatus | undefined;
  function cleanup(now = Date.now()): void {
    const event = "public_mcp_gateway.cleanup";
    const startedAt = new Date(now).toISOString();
    try {
      const counts = store.pruneExpiredCredentials(now);
      lastCleanup = {
        status: "ok",
        startedAt,
        ...counts,
        dcrRegistrationCapacityRemaining: Math.max(
          0,
          limits.registrations - counts.dcrRegistrationsUsed,
        ),
      };
      console.info(JSON.stringify({ event, ...lastCleanup }));
    } catch {
      lastCleanup = { status: "failed", startedAt };
      console.error(JSON.stringify({ event, ...lastCleanup }));
    }
  }

  async function fetch(incoming: Request): Promise<Response> {
    const url = new URL(incoming.url);
    if (
      url.host !== new URL(origin).host ||
      (incoming.headers.get("Host") ?? url.host) !== url.host
    )
      return new Response(null, { status: 400 });
    const canonical = new Request(
      new URL(origin + url.pathname + url.search),
      incoming,
    );
    try {
      const response =
        (await browser.handle(canonical)) ??
        (await enrollment(canonical)) ??
        (await oauth(canonical)) ??
        (await downloads.handle(canonical)) ??
        (await mcp(canonical));
      if (response) {
        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "private, no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
      return url.pathname === "/health"
        ? Response.json(
            { ready: true },
            { headers: { "Cache-Control": "no-store" } },
          )
        : new Response(null, { status: 404 });
    } catch {
      return Response.json(
        { error: "gateway_unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    }
  }

  const server = createAdaptorServer({ fetch, hostname: "127.0.0.1" });
  if (!(server instanceof Server))
    throw new Error("The gateway requires a local HTTP/1 listener");
  agent.listen(server);
  return {
    fetch,
    server,
    tokens,
    pairing,
    cleanup,
    closeConnections: () => agent.close(),
  };
}
