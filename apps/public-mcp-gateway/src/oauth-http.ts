import { readBoundedBody } from "@latex-renderer/shared/bounded-body";
import { decodeJwt } from "jose";
import { rendererMcpScopes } from "@latex-renderer/contracts";
import type { HttpsJsonClient } from "./https-json.js";
import {
  parseDcrClientRegistration,
  readCimdClient,
  verifyCimdClientAssertion,
  type CimdClientTrust,
  type DcrClientStore,
} from "./oauth-clients.js";
import {
  validateOAuthAuthorizationRequest,
  type GatewayOAuthTokens,
  type OAuthAuthorizationRequest,
} from "./oauth-tokens.js";

interface OAuthHttpOptions {
  tokens: GatewayOAuthTokens;
  clients: DcrClientStore;
  dcrRedirectUris: ReadonlySet<string>;
  cimdClients: ReadonlyMap<string, CimdClientTrust>;
  dcrCapacity: number;
  maxBodyBytes: number;
  maxMetadataBytes: number;
  networkTimeoutMs: number;
  assertionLifetimeSeconds: number;
  allowRegistration: (request: Request) => boolean;
  claimAssertion: (hash: string, expiresAt: number, now: number) => boolean;
  showConsent: (
    request: Request,
    authorization: OAuthAuthorizationRequest,
    clientName: string,
  ) => Promise<Response>;
  submitConsent: (
    request: Request,
    fields: URLSearchParams,
  ) => Promise<Response>;
  requestMetadata?: HttpsJsonClient;
}

const bearerMetadataPath = "/.well-known/oauth-protected-resource/mcp";

/** OAuth HTTP entry points. The consent UI supplies its own CSRF and verified-local-approval checks. */
export function createGatewayOAuthHandler(options: OAuthHttpOptions) {
  const { tokens } = options;
  if (!options.dcrRedirectUris.size || !options.cimdClients.size)
    throw new Error(
      "Configure approved DCR and CIMD clients before serving public OAuth",
    );
  const authorization = {
    issuer: tokens.issuer,
    authorization_endpoint: `${tokens.issuer}/oauth/authorize`,
    token_endpoint: `${tokens.issuer}/oauth/token`,
    registration_endpoint: `${tokens.issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
    token_endpoint_auth_signing_alg_values_supported: ["RS256"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    client_id_metadata_document_supported: true,
    scopes_supported: rendererMcpScopes,
  };
  const resource = {
    resource: tokens.resource,
    authorization_servers: [tokens.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: rendererMcpScopes,
  };

  return async function handle(
    request: Request,
  ): Promise<Response | undefined> {
    const url = new URL(request.url);
    if (url.origin !== tokens.issuer) return oauthError("invalid_request", 400);
    const { pathname } = url;
    if (request.method === "GET") {
      if (pathname === "/.well-known/oauth-authorization-server")
        return json(authorization);
      if (
        pathname === bearerMetadataPath ||
        pathname === "/.well-known/oauth-protected-resource"
      )
        return json(resource);
      if (pathname === "/oauth/authorize") {
        try {
          const client = await lookupClient(
            one(url.searchParams, "client_id"),
            request.signal,
          );
          if (!client) return oauthError("invalid_client", 400);
          const authorization = validateOAuthAuthorizationRequest(
            url.searchParams,
            client,
            tokens.resource,
          );
          return noStore(
            await options.showConsent(
              request,
              authorization,
              client.clientName,
            ),
          );
        } catch {
          return oauthError("invalid_request", 400);
        }
      }
    }
    if (request.method !== "POST") return undefined;
    if (pathname === "/oauth/register") {
      if (!options.allowRegistration(request))
        return oauthError("temporarily_unavailable", 429);
      try {
        const raw = await readBoundedBody(
          request,
          "application/json",
          options.maxBodyBytes,
        );
        const registration = parseDcrClientRegistration(
          JSON.parse(raw) as unknown,
          options.dcrRedirectUris,
        );
        const client = options.clients.registerDcrClient(
          registration,
          options.dcrCapacity,
        );
        if (!client) return oauthError("temporarily_unavailable", 503);
        return json(
          {
            client_id: client.id,
            client_name: client.clientName,
            redirect_uris: client.redirectUris,
            token_endpoint_auth_method: "none",
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
          },
          201,
        );
      } catch {
        return oauthError("invalid_client_metadata", 400);
      }
    }
    if (pathname === "/oauth/authorize") {
      if (request.headers.get("origin") !== tokens.issuer)
        return oauthError("invalid_request", 403);
      try {
        return noStore(
          await options.submitConsent(request, await form(request)),
        );
      } catch {
        return oauthError("invalid_request", 400);
      }
    }
    if (pathname === "/oauth/token") {
      let fields: URLSearchParams;
      let grantType: string | null;
      try {
        fields = await form(request);
        grantType = one(fields, "grant_type");
      } catch {
        return oauthError("invalid_request", 400);
      }
      if (grantType !== "authorization_code" && grantType !== "refresh_token")
        return oauthError("unsupported_grant_type", 400);
      let clientId: string;
      try {
        clientId = await authenticateClient(fields, request.signal);
      } catch {
        return oauthError("invalid_client", 400);
      }
      try {
        return json(
          grantType === "authorization_code"
            ? tokens.exchangeCode(clientId, fields)
            : tokens.refresh(clientId, fields),
        );
      } catch {
        return oauthError("invalid_grant", 400);
      }
    }
    return undefined;
  };

  async function form(request: Request): Promise<URLSearchParams> {
    return new URLSearchParams(
      await readBoundedBody(
        request,
        "application/x-www-form-urlencoded",
        options.maxBodyBytes,
      ),
    );
  }

  function metadataLimits(signal: AbortSignal) {
    return {
      maxResponseBytes: options.maxMetadataBytes,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(options.networkTimeoutMs),
      ]),
    };
  }

  async function lookupClient(clientId: string | null, signal: AbortSignal) {
    if (!clientId) return undefined;
    if (options.cimdClients.has(clientId))
      return readCimdClient(
        clientId,
        options.cimdClients,
        metadataLimits(signal),
        options.requestMetadata,
      );
    return /^gateway_client_[a-f0-9]{32}$/.test(clientId)
      ? options.clients.dcrClient(clientId)
      : undefined;
  }

  async function authenticateClient(
    fields: URLSearchParams,
    signal: AbortSignal,
  ): Promise<string> {
    if (fields.has("client_secret"))
      throw new Error("Unsupported client credentials");
    const assertion = one(fields, "client_assertion");
    const clientId =
      one(fields, "client_id") ??
      (assertion === null ? null : (decodeJwt(assertion).sub ?? null));
    const client = await lookupClient(clientId, signal);
    if (!client) throw new Error("OAuth client does not exist");
    if ("jwksUri" in client) {
      await verifyCimdClientAssertion(
        client,
        fields,
        {
          ...metadataLimits(signal),
          audience: authorization.token_endpoint,
          now: tokens.clock(),
          maxLifetimeSeconds: options.assertionLifetimeSeconds,
          claimAssertion: options.claimAssertion,
        },
        options.requestMetadata,
      );
    } else if (assertion !== null || fields.has("client_assertion_type")) {
      throw new Error("Unsupported DCR client credentials");
    }
    return client.id;
  }
}

function one(parameters: URLSearchParams, name: string): string | null {
  const values = parameters.getAll(name);
  if (values.length > 1) throw new Error("Duplicate OAuth parameter");
  return values[0] ?? null;
}

function noStore(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-store");
  if (!headers.has("Referrer-Policy"))
    headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, headers });
}

function json(value: unknown, status = 200): Response {
  return noStore(Response.json(value, { status }));
}

function oauthError(error: string, status: number): Response {
  return json({ error }, status);
}
