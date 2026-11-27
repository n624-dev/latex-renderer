import { randomBytes } from "node:crypto";
import {
  rendererMcpToolPolicies,
  rendererRelayIdentityMessage,
  rendererRelayIdentityProofSchema,
  rendererRelayOperationPath,
  rendererRelayPublicIdentityPath,
  rendererRelayRevokePath,
  rendererRelayVersion,
  rendererRelayDownloadPath,
  type RendererRelayDownloadRequest,
} from "@latex-renderer/contracts";
import { verifySignature } from "./agent-enrollment-proof.js";
import type { ConnectionStore } from "./connections.js";
import {
  HttpsCredentialKeys,
  type HttpsCredentials,
} from "./https-credential-keys.js";
import {
  HttpsResponseError,
  requestHttpsJson,
  type HttpsJsonClient,
} from "./https-json.js";
import {
  asRendererTool,
  DispatchFailure,
  type DispatchTransport,
} from "./renderer-dispatch.js";
import type { RendererHttpsConnection } from "./renderer-https-discovery.js";
import { RendererHttpsOAuth } from "./renderer-https-oauth.js";

export async function verifyHttpsRenderer(
  issuer: string,
  credentials: HttpsCredentials,
  limits: {
    maxResponseBytes: number;
    signal: AbortSignal;
  },
  request: HttpsJsonClient = requestHttpsJson,
) {
  const nonce = randomBytes(32).toString("base64url");
  const out = await request({
    url: new URL(rendererRelayPublicIdentityPath, issuer),
    trustedOrigin: issuer,
    bearer: credentials.accessToken,
    body: { contentType: "application/json", text: JSON.stringify({ nonce }) },
    ...limits,
  });
  const proof = rendererRelayIdentityProofSchema.safeParse(out);
  if (
    !proof.success ||
    !verifySignature(
      proof.data.instance.publicKey,
      proof.data.signature,
      rendererRelayIdentityMessage(issuer, nonce, proof.data),
    )
  )
    throw new DispatchFailure("renderer_upgrade_required");
  return proof.data;
}

export function createHttpsDispatch(options: {
  store: ConnectionStore;
  keys: HttpsCredentialKeys;
  maxResponseBytes: number;
  timeoutMs: number;
  request?: HttpsJsonClient;
  clock?: () => number;
}) {
  const request = options.request ?? requestHttpsJson;
  const clock = options.clock ?? Date.now;
  const refreshes = new Map<string, Promise<HttpsCredentials>>();

  async function credentialsFor(
    id: string,
    connection: RendererHttpsConnection,
    rejectedAccessToken?: string,
  ): Promise<HttpsCredentials> {
    const stored = options.store.httpsCredentials(id, clock());
    if (!stored) throw new DispatchFailure("reauthentication_required");
    const credentials = options.keys.open(id, stored.envelope);
    if (
      credentials.expiresAt > clock() &&
      credentials.accessToken !== rejectedAccessToken
    )
      return credentials;
    const previous = refreshes.get(id);
    if (previous) return previous;
    const refreshed = (async () => {
      try {
        if (credentials.refreshToken === null)
          throw new DispatchFailure("reauthentication_required");
        const client = new RendererHttpsOAuth(
          connection,
          options.maxResponseBytes,
          request,
          clock,
        );
        const renewed = await client.refresh(
          credentials,
          AbortSignal.timeout(options.timeoutMs),
        );
        if (
          !options.store.replaceHttpsCredentials(
            id,
            options.keys.seal(id, renewed),
            stored.generation,
            clock(),
          )
        )
          throw new DispatchFailure("connection_revoked");
        return renewed;
      } catch (error) {
        if (
          (error instanceof HttpsResponseError &&
            (error.status === 400 || error.status === 401)) ||
          (error instanceof DispatchFailure &&
            error.code === "reauthentication_required")
        ) {
          options.store.requireReauthentication(id);
          throw new DispatchFailure("reauthentication_required");
        }
        throw error;
      }
    })().finally(() => refreshes.delete(id));
    refreshes.set(id, refreshed);
    return refreshed;
  }

  async function retryReadAfterUnauthorized(
    id: string,
    connection: RendererHttpsConnection,
    credentials: HttpsCredentials,
    call: (accessToken: string) => Promise<unknown>,
    readOnly: boolean,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const renewed = await credentialsFor(id, connection, credentials.accessToken);
    if (!readOnly) throw new DispatchFailure("outcome_unknown");
    signal.throwIfAborted();
    try {
      return await call(renewed.accessToken);
    } catch (error) {
      if (!(error instanceof HttpsResponseError) || error.status !== 401)
        throw error;
      options.store.requireReauthentication(id);
      throw new DispatchFailure("reauthentication_required");
    }
  }

  return {
    async dispatch({
      authorization,
      transport,
      operation,
      signal,
    }: Parameters<DispatchTransport>[0]) {
      if (transport.endpoint.kind !== "https")
        throw new DispatchFailure("invalid_operation");
      const connection = connectionFor(transport.endpoint.mcpUrl);
      let credentials: HttpsCredentials;
      try {
        credentials = await credentialsFor(authorization.id, connection);
      } catch (error) {
        if (error instanceof DispatchFailure) throw error;
        throw new DispatchFailure("connection_offline");
      }
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
      const call = (bearer: string) =>
        request({
          url: new URL(rendererRelayOperationPath, connection.issuer),
          trustedOrigin: connection.issuer,
          bearer,
          maxResponseBytes: options.maxResponseBytes,
          signal: requestSignal,
          body: {
            contentType: "application/json",
            text: JSON.stringify({
              version: rendererRelayVersion,
              instanceId: authorization.instanceId,
              grant: authorization.localGrantId,
              scopes: authorization.scopes,
              operation,
            }),
          },
        });
      try {
        return await call(credentials.accessToken);
      } catch (error) {
        if (error instanceof HttpsResponseError && error.status === 404)
          throw new DispatchFailure("renderer_upgrade_required");
        if (error instanceof HttpsResponseError && error.status === 403)
          throw new DispatchFailure("insufficient_scope");
        if (error instanceof HttpsResponseError && error.status === 401) {
          const tool = operation.method === "tools/call" && asRendererTool(operation.name);
          return retryReadAfterUnauthorized(
            authorization.id,
            connection,
            credentials,
            call,
            operation.method === "resources/read" || (tool ? rendererMcpToolPolicies[tool].replay === "read" : false),
            requestSignal,
          );
        }
        throw error;
      }
    },
    async download(
      authorizationId: string,
      mcpUrl: string,
      input: RendererRelayDownloadRequest,
      signal: AbortSignal,
    ) {
      const connection = connectionFor(mcpUrl);
      const credentials = await credentialsFor(authorizationId, connection);
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]);
      const call = (bearer: string) => request({
        url: new URL(rendererRelayDownloadPath, connection.issuer),
        trustedOrigin: connection.issuer,
        bearer,
        maxResponseBytes: options.maxResponseBytes,
        signal: requestSignal,
        body: { contentType: "application/json", text: JSON.stringify(input) },
      });
      try {
        return await call(credentials.accessToken);
      } catch (error) {
        if (!(error instanceof HttpsResponseError) || error.status !== 401)
          throw error;
        return retryReadAfterUnauthorized(authorizationId, connection, credentials, call, true, requestSignal);
      }
    },
    async revoke(authorizationId: string, mcpUrl: string) {
      const connection = connectionFor(mcpUrl);
      const credentials = await credentialsFor(authorizationId, connection);
      await request({
        url: new URL(rendererRelayRevokePath, connection.issuer),
        trustedOrigin: connection.issuer,
        maxResponseBytes: options.maxResponseBytes,
        signal: AbortSignal.timeout(options.timeoutMs),
        bearer: credentials.accessToken,
        body: { contentType: "application/json", text: "{}" },
      });
    },
  };
}

function connectionFor(resource: string): RendererHttpsConnection {
  const { origin } = new URL(resource);
  return {
    resource,
    issuer: origin,
    authorizationEndpoint: `${origin}/oauth/authorize`,
    registrationEndpoint: `${origin}/oauth/register`,
    tokenEndpoint: `${origin}/oauth/token`,
    responseIncludesIssuer: false,
  };
}
