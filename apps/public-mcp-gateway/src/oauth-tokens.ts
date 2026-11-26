import { createHash, createHmac, randomBytes } from "node:crypto";
import {
  parsePublicMcpRequestedScopes,
  type RendererMcpScope,
} from "@latex-renderer/contracts";
import type { ConnectionAuthorization } from "./connections.js";

export const accessTokenLifetimeMs = 10 * 60_000;
export const authorizationLifetimeMs = 30 * 86_400_000;
const tokenRefreshRetryWindowMs = 30_000;

export interface OAuthAuthorizationRequest {
  clientId: string;
  redirectUri: string;
  resource: string;
  codeChallenge: string;
  state: string | null;
  scopes: readonly RendererMcpScope[];
}

export interface TokenExchangeStore {
  beginConsent(
    proof: ConsentProof,
    expiresAt: number,
    now: number,
    capacity: number,
  ): boolean;
  consumeConsent(proof: ConsentProof, now: number): boolean;
  recordCode(input: {
    consent: ConsentProof;
    hash: string;
    authorizationId: string | null;
    request: OAuthAuthorizationRequest;
    approvedScopes: readonly RendererMcpScope[];
    expiresAt: number;
    now: number;
  }): ConnectionAuthorization | undefined;
  exchangeCode(input: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    codeChallenge: string;
    accessHash: string;
    refreshHash: string;
    now: number;
  }): IssuedGrant | undefined;
  refresh(input: {
    oldHash: string;
    clientId: string;
    resource: string;
    accessHash: string;
    refreshHash: string;
    now: number;
    retryWindowMs: number;
    requestedScopes: readonly RendererMcpScope[] | null;
  }): IssuedGrant | undefined;
  accessAuthorization(
    hash: string,
    resource: string,
    now: number,
  ): ConnectionAuthorization | undefined;
}

export interface IssuedGrant {
  scopes: readonly RendererMcpScope[];
  accessExpiresAt: number;
}

export interface ConsentSession {
  id: string;
  browserSecret: string;
}

export interface ConsentProof {
  id: string;
  browserHash: string;
  requestHash: string;
}

export function validateOAuthAuthorizationRequest(
  parameters: URLSearchParams,
  client: { id: string; redirectUris: readonly string[] },
  resource: string,
): OAuthAuthorizationRequest {
  const clientId = parameter(parameters, "client_id");
  const redirectUri = parameter(parameters, "redirect_uri");
  const codeChallenge = parameter(parameters, "code_challenge");
  const state = parameter(parameters, "state");
  const scopes = parsePublicMcpRequestedScopes(parameter(parameters, "scope"));
  if (
    clientId !== client.id ||
    !redirectUri ||
    !client.redirectUris.includes(redirectUri) ||
    parameter(parameters, "resource") !== resource ||
    parameter(parameters, "response_type") !== "code" ||
    parameter(parameters, "code_challenge_method") !== "S256" ||
    !codeChallenge ||
    !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge) ||
    !scopes
  )
    throw new Error("Invalid OAuth authorization request");
  return { clientId, redirectUri, codeChallenge, state, resource, scopes };
}

export class GatewayOAuthTokens {
  readonly #refreshKey: Buffer;
  readonly #resource: string;

  constructor(
    readonly issuer: string,
    readonly storage: TokenExchangeStore,
    refreshKey: Uint8Array,
    readonly authorizationCodeLifetimeMs: number,
    readonly clock: () => number = Date.now,
  ) {
    const url = URL.parse(issuer);
    if (
      url === null ||
      url.protocol !== "https:" ||
      url.origin !== issuer ||
      refreshKey.byteLength !== 32 ||
      !Number.isSafeInteger(authorizationCodeLifetimeMs) ||
      authorizationCodeLifetimeMs < 1
    )
      throw new Error("Invalid public OAuth issuer or token settings");
    this.#refreshKey = Buffer.from(refreshKey);
    this.#resource = `${issuer}/mcp`;
  }

  get resource(): string {
    return this.#resource;
  }

  beginConsent(
    request: OAuthAuthorizationRequest,
    limits: { lifetimeMs: number; capacity: number },
  ): ConsentSession {
    const now = this.clock();
    if (
      request.resource !== this.resource ||
      !Number.isSafeInteger(limits.lifetimeMs) ||
      limits.lifetimeMs <= 0 ||
      !Number.isSafeInteger(limits.capacity) ||
      limits.capacity <= 0
    )
      throw new Error("Invalid OAuth consent request or settings");
    const session = {
      id: randomBytes(24).toString("base64url"),
      browserSecret: randomBytes(32).toString("base64url"),
    };
    if (
      !this.storage.beginConsent(
        consentProof(session, request),
        now + limits.lifetimeMs,
        now,
        limits.capacity,
      )
    )
      throw new Error("OAuth consent is temporarily unavailable");
    return session;
  }

  /** Called only after the browser has confirmed its pairing or HTTPS approval. */
  completeConsent(
    session: ConsentSession,
    request: OAuthAuthorizationRequest,
    authorizationId: string,
    approvedScopes: readonly RendererMcpScope[],
  ): URL {
    return this.#completeConsent(
      session,
      request,
      authorizationId,
      approvedScopes,
    ).location;
  }

  completePairedConsent(
    session: ConsentSession,
    request: OAuthAuthorizationRequest,
    approvedScopes: readonly RendererMcpScope[],
  ): URL {
    return this.completePairedConsentWithGrant(session, request, approvedScopes)
      .location;
  }

  completePairedConsentWithGrant(
    session: ConsentSession,
    request: OAuthAuthorizationRequest,
    approvedScopes: readonly RendererMcpScope[],
  ): { location: URL; grant: ConnectionAuthorization } {
    return this.#completeConsent(session, request, null, approvedScopes);
  }

  #completeConsent(
    session: ConsentSession,
    request: OAuthAuthorizationRequest,
    authorizationId: string | null,
    approvedScopes: readonly RendererMcpScope[],
  ): { location: URL; grant: ConnectionAuthorization } {
    const now = this.clock();
    if (
      request.resource !== this.resource ||
      approvedScopes.length === 0 ||
      approvedScopes.some((scope) => !request.scopes.includes(scope))
    )
      throw new Error("OAuth approval cannot expand the requested scopes");
    const code = randomToken("code");
    const issued = this.storage.recordCode({
      consent: consentProof(session, request),
      hash: hash(code),
      authorizationId,
      request,
      approvedScopes,
      expiresAt: now + this.authorizationCodeLifetimeMs,
      now,
    });
    if (!issued) throw new Error("OAuth approval is unavailable");
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("code", code);
    redirect.searchParams.set("iss", this.issuer);
    if (request.state !== null)
      redirect.searchParams.set("state", request.state);
    return { location: redirect, grant: issued };
  }

  denyConsent(
    session: ConsentSession,
    request: OAuthAuthorizationRequest,
  ): URL {
    if (
      request.resource !== this.resource ||
      !this.storage.consumeConsent(consentProof(session, request), this.clock())
    )
      throw new Error("OAuth consent is unavailable");
    const redirect = new URL(request.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    redirect.searchParams.set("iss", this.issuer);
    if (request.state !== null)
      redirect.searchParams.set("state", request.state);
    return redirect;
  }

  /** Client authentication (including CIMD signature verification) precedes exchange. */
  exchangeCode(clientId: string, form: URLSearchParams) {
    const code = parameter(form, "code"),
      codeVerifier = parameter(form, "code_verifier");
    const redirectUri = parameter(form, "redirect_uri");
    if (
      !code ||
      !validToken(code, "code") ||
      !redirectUri ||
      parameter(form, "resource") !== this.resource ||
      !codeVerifier ||
      !/^[A-Za-z0-9._~-]{43,128}$/.test(codeVerifier)
    )
      throw invalidGrant();
    const now = this.clock(),
      access = randomToken("access"),
      refresh = randomToken("refresh");
    const granted = this.storage.exchangeCode({
      codeHash: hash(code),
      clientId,
      redirectUri,
      resource: this.resource,
      codeChallenge: createHash("sha256")
        .update(codeVerifier)
        .digest("base64url"),
      accessHash: hash(access),
      refreshHash: hash(refresh),
      now,
    });
    if (!granted) throw invalidGrant();
    return tokenResponse(access, refresh, granted, now);
  }

  refresh(clientId: string, form: URLSearchParams) {
    const oldRefresh = parameter(form, "refresh_token");
    const scope = parameter(form, "scope");
    const requestedScopes =
      scope === null ? null : parsePublicMcpRequestedScopes(scope);
    if (
      !oldRefresh ||
      !validToken(oldRefresh, "refresh") ||
      parameter(form, "resource") !== this.resource ||
      (scope !== null && requestedScopes === null)
    )
      throw invalidGrant();
    // Recompute the same reply after a lost response without persisting the
    // previous or replacement token in plaintext, even across a restart.
    const next = (kind: "access" | "refresh") =>
      `gateway_${kind}_${createHmac("sha256", this.#refreshKey)
        .update(
          JSON.stringify([
            "public-mcp-refresh-v1",
            kind,
            this.resource,
            clientId,
            oldRefresh,
          ]),
        )
        .digest("base64url")}`;
    const now = this.clock(),
      access = next("access"),
      refresh = next("refresh");
    const granted = this.storage.refresh({
      oldHash: hash(oldRefresh),
      clientId,
      resource: this.resource,
      accessHash: hash(access),
      refreshHash: hash(refresh),
      now,
      retryWindowMs: tokenRefreshRetryWindowMs,
      requestedScopes,
    });
    if (!granted) throw invalidGrant();
    return tokenResponse(access, refresh, granted, now);
  }

  authenticate(token: string): ConnectionAuthorization | undefined {
    return validToken(token, "access")
      ? this.storage.accessAuthorization(
          hash(token),
          this.resource,
          this.clock(),
        )
      : undefined;
  }
}

export function consentProof(
  session: ConsentSession,
  request: OAuthAuthorizationRequest,
): ConsentProof {
  return {
    id: session.id,
    browserHash: hash(session.browserSecret),
    requestHash: createHmac("sha256", session.browserSecret)
      .update("latex-renderer-consent-v1\0")
      .update(
        JSON.stringify([
          request.clientId,
          request.redirectUri,
          request.resource,
          request.codeChallenge,
          request.state,
          request.scopes,
        ]),
      )
      .digest("hex"),
  };
}

function parameter(parameters: URLSearchParams, key: string): string | null {
  const values = parameters.getAll(key);
  if (values.length > 1) throw new Error("Duplicate OAuth parameter");
  return values[0] ?? null;
}

function hash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type TokenKind = "access" | "refresh" | "code";

function randomToken(kind: TokenKind): string {
  return `gateway_${kind}_${randomBytes(32).toString("base64url")}`;
}

function validToken(token: string, kind: TokenKind): boolean {
  const prefix = `gateway_${kind}_`;
  return (
    token.startsWith(prefix) &&
    /^[A-Za-z0-9_-]{43}$/.test(token.slice(prefix.length))
  );
}

function invalidGrant(): Error {
  return new Error("OAuth grant is invalid or expired");
}

function tokenResponse(
  access: string,
  refresh: string,
  grant: IssuedGrant,
  now: number,
) {
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: "Bearer" as const,
    expires_in: Math.ceil((grant.accessExpiresAt - now) / 1000),
    scope: grant.scopes.join(" "),
  };
}
