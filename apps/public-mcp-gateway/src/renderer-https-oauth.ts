import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  isRendererMcpScope,
  type RendererMcpScope,
} from "@latex-renderer/contracts";
import type { HttpsCredentials } from "./https-credential-keys.js";
import { requestHttpsJson, type HttpsJsonClient } from "./https-json.js";
import {
  validateRendererCallbackIssuer,
  type RendererHttpsConnection,
} from "./renderer-https-discovery.js";

export interface RendererAuthorizationAttempt {
  authorizationUrl: string;
  clientId: string;
  redirectUri: string;
  state: string;
  verifier: string;
  scopes: readonly RendererMcpScope[];
  connection: RendererHttpsConnection;
}

export class RendererHttpsOAuth {
  constructor(
    private readonly connection: RendererHttpsConnection,
    private readonly maxResponseBytes: number,
    private readonly request: HttpsJsonClient = requestHttpsJson,
    private readonly clock: () => number = Date.now,
  ) {}

  async registerClient(
    redirectUri: string,
    signal: AbortSignal,
  ): Promise<string> {
    requireGatewayRedirect(redirectUri);
    const registered = await this.#call(
      this.connection.registrationEndpoint,
      "application/json",
      JSON.stringify({
        client_name: "LaTeX Renderer gateway",
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
      signal,
    );
    if (
      !isObject(registered) ||
      !isSafeIdentifier(registered.client_id) ||
      registered.token_endpoint_auth_method !== "none" ||
      !Array.isArray(registered.redirect_uris) ||
      registered.redirect_uris.length !== 1 ||
      registered.redirect_uris[0] !== redirectUri
    )
      throw new Error(
        "Renderer client registration did not match the callback",
      );
    return registered.client_id;
  }

  authorize(
    clientId: string,
    redirectUri: string,
    scopes: readonly RendererMcpScope[],
  ): RendererAuthorizationAttempt {
    requireGatewayRedirect(redirectUri);
    if (
      !isSafeIdentifier(clientId) ||
      scopes.length === 0 ||
      !scopes.every(isRendererMcpScope)
    )
      throw new Error("Invalid Renderer authorization settings");
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    const url = new URL(this.connection.authorizationEndpoint);
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      resource: this.connection.resource,
      state,
      scope: [...new Set(scopes)].join(" "),
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }).toString();
    return {
      authorizationUrl: url.href,
      clientId,
      redirectUri,
      state,
      verifier,
      scopes: [...scopes],
      connection: this.connection,
    };
  }

  async exchange(
    attempt: RendererAuthorizationAttempt,
    callback: URL,
    signal: AbortSignal,
  ): Promise<HttpsCredentials> {
    const {
      clientId,
      redirectUri,
      verifier,
      scopes,
      state: expectedState,
      connection,
    } = attempt;
    if (
      connection.resource !== this.connection.resource ||
      connection.issuer !== this.connection.issuer ||
      callback.origin + callback.pathname !== redirectUri ||
      callback.username ||
      callback.password ||
      callback.hash
    )
      throw new Error(
        "Renderer callback did not match the authorization request",
      );
    const state = single(callback.searchParams, "state"),
      issuer = single(callback.searchParams, "iss");
    if (
      !state ||
      !constantTimeEqual(state, expectedState) ||
      !validateRendererCallbackIssuer(issuer, this.connection)
    )
      throw new Error("Renderer callback authorization state is invalid");
    const code = single(callback.searchParams, "code");
    if (
      single(callback.searchParams, "error") !== null ||
      !isSafeIdentifier(code)
    )
      throw new Error("Renderer authorization was not granted");
    return this.#token(
      clientId,
      scopes,
      {
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: verifier,
        code,
      },
      signal,
    );
  }

  async refresh(
    credentials: HttpsCredentials,
    signal: AbortSignal,
  ): Promise<HttpsCredentials> {
    if (credentials.refreshToken === null)
      throw new Error("Renderer reauthentication is required");
    const renewed = await this.#token(
      credentials.clientId,
      credentials.scopes,
      { grant_type: "refresh_token", refresh_token: credentials.refreshToken },
      signal,
    );
    return {
      ...renewed,
      refreshToken: renewed.refreshToken ?? credentials.refreshToken,
    };
  }

  async getProfile(
    accessToken: string,
    protocolVersion: string,
    signal: AbortSignal,
  ): Promise<{ id: string }> {
    const id = randomBytes(16).toString("hex");
    const message = await this.request({
      url: new URL(this.connection.resource),
      trustedOrigin: this.connection.issuer,
      maxResponseBytes: this.maxResponseBytes,
      accept: "application/json, text/event-stream",
      bearer: accessToken,
      signal,
      protocolVersion,
      body: {
        contentType: "application/json",
        text: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "get_profile", arguments: {} },
        }),
      },
    });
    if (
      !isObject(message) ||
      message.jsonrpc !== "2.0" ||
      message.id !== id ||
      !isObject(message.result) ||
      message.result.isError === true ||
      !isObject(message.result.structuredContent) ||
      !isSafeIdentifier(message.result.structuredContent.id)
    )
      throw new Error("Renderer did not return a verified profile");
    return { id: message.result.structuredContent.id };
  }

  async #token(
    clientId: string,
    scopes: readonly RendererMcpScope[],
    form: Record<string, string>,
    signal: AbortSignal,
  ): Promise<HttpsCredentials> {
    const response = await this.#call(
      this.connection.tokenEndpoint,
      "application/x-www-form-urlencoded",
      new URLSearchParams({
        ...form,
        client_id: clientId,
        resource: this.connection.resource,
      }).toString(),
      signal,
    );
    if (
      !isObject(response) ||
      typeof response.token_type !== "string" ||
      response.token_type.toLowerCase() !== "bearer" ||
      !isSafeIdentifier(response.access_token) ||
      (response.refresh_token !== undefined &&
        !isSafeIdentifier(response.refresh_token)) ||
      typeof response.expires_in !== "number" ||
      !Number.isSafeInteger(response.expires_in) ||
      response.expires_in <= 0 ||
      typeof response.scope !== "string"
    )
      throw new Error(
        "Renderer token response did not match the authorization",
      );
    const approved = response.scope.split(" ");
    const expiresAt = this.clock() + response.expires_in * 1000;
    if (
      !approved.every(
        (scope): scope is RendererMcpScope =>
          isRendererMcpScope(scope) && scopes.includes(scope),
      ) ||
      !Number.isSafeInteger(expiresAt)
    )
      throw new Error("Renderer token has invalid permissions or expiry");
    return {
      accessToken: response.access_token,
      refreshToken: response.refresh_token ?? null,
      clientId,
      scopes: [...new Set(approved)],
      expiresAt,
    };
  }

  #call(
    url: string,
    contentType: string,
    text: string,
    signal: AbortSignal,
  ): Promise<unknown> {
    return this.request({
      url: new URL(url),
      trustedOrigin: this.connection.issuer,
      signal,
      maxResponseBytes: this.maxResponseBytes,
      body: { contentType, text },
    });
  }
}

function requireGatewayRedirect(redirect: string): void {
  const url = URL.parse(redirect);
  if (
    !url ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== redirect
  )
    throw new Error("Invalid gateway callback URL");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~+/=-]+$/.test(value);
}

function single(parameters: URLSearchParams, key: string): string | null {
  const values = parameters.getAll(key);
  if (values.length > 1)
    throw new Error("Renderer supplied a duplicate OAuth parameter");
  return values[0] ?? null;
}

function constantTimeEqual(left: string, right: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(left), digest(right));
}
