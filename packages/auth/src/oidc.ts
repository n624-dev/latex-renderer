import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { AppError } from "@latex-renderer/shared";
import type { ExternalIdentity } from "./access.js";

const MAXIMUM_DISCOVERY_BYTES = 64 * 1024;
const MAXIMUM_TOKEN_BYTES = 64 * 1024;
const MAXIMUM_JWKS_BYTES = 256 * 1024;
const MAXIMUM_EXP_SECONDS = 253_402_300_799;
const FLOW_LIFETIME_MS = 5 * 60 * 1000;
const FLOW_START_WINDOW_MS = 15 * 60 * 1000;
const MAXIMUM_FLOW_STARTS_PER_CLIENT = 20;
const MAXIMUM_FLOW_START_RATE_KEYS = 10_000;

export interface OidcClientOptions {
  issuer: string;
  clientId: string;
  clientSecret: string;
  publicOrigin: string;
  algorithms?: readonly string[] | undefined;
  fetchImpl?: typeof fetch | undefined;
  now?: (() => Date) | undefined;
}

interface OidcMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  response_types_supported?: unknown;
  code_challenge_methods_supported?: unknown;
  token_endpoint_auth_methods_supported?: unknown;
}

interface OidcFlow {
  nonce: string;
  verifier: string;
  returnTo: string;
  expiresAt: number;
}

interface OidcFlowStartWindow {
  windowStartedAt: number;
  count: number;
}

export interface OidcAuthorizationStart {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

export class OidcClient {
  readonly issuer: string;
  readonly callbackUri: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly algorithms: readonly string[];
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly flows = new Map<string, OidcFlow>();
  private readonly flowStartWindows = new Map<string, OidcFlowStartWindow>();
  private metadataPromise: Promise<OidcMetadata> | undefined;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(options: OidcClientOptions) {
    this.issuer = strictHttpsUrl(options.issuer, "OIDC issuer");
    this.clientId = bounded(options.clientId, "OIDC client id", 1, 500);
    this.clientSecret = bounded(
      options.clientSecret,
      "OIDC client secret",
      16,
      4096,
    );
    const origin = strictHttpsOrigin(options.publicOrigin, "PUBLIC_ORIGIN");
    this.callbackUri = new URL("/auth/oidc/callback", origin).toString();
    this.algorithms = options.algorithms ?? ["RS256", "ES256"];
    if (
      this.algorithms.length === 0 ||
      new Set(this.algorithms).size !== this.algorithms.length ||
      this.algorithms.some(
        (algorithm) =>
          !["RS256", "RS384", "RS512", "ES256", "ES384", "ES512"].includes(
            algorithm,
          ),
      )
    )
      throw new Error("OIDC algorithms must be an asymmetric allowlist");
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async begin(
    returnTo = "/app/",
    clientAddress = "unavailable",
  ): Promise<OidcAuthorizationStart> {
    this.pruneFlows();
    this.consumeFlowStart(clientAddress);
    const metadata = await this.metadata();
    this.pruneFlows();
    const state = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const expiresAt = this.now().getTime() + FLOW_LIFETIME_MS;
    this.flows.set(hash(state), {
      nonce,
      verifier,
      returnTo: safeReturnTo(returnTo),
      expiresAt,
    });
    const authorization = new URL(metadata.authorization_endpoint);
    authorization.search = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: this.callbackUri,
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: hashBase64Url(verifier),
      code_challenge_method: "S256",
    }).toString();
    return {
      authorizationUrl: authorization.toString(),
      state,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async callback(input: {
    code: string;
    state: string;
    stateCookie: string;
  }): Promise<{ identity: ExternalIdentity; returnTo: string }> {
    if (!safeEqual(input.state, input.stateCookie))
      throw new AppError(
        "OIDC_STATE_INVALID",
        "OIDC login state is invalid or expired",
        401,
      );
    const flowKey = hash(input.state);
    const flow = this.flows.get(flowKey);
    this.flows.delete(flowKey);
    if (flow === undefined || flow.expiresAt <= this.now().getTime())
      throw new AppError(
        "OIDC_STATE_INVALID",
        "OIDC login state is invalid or expired",
        401,
      );
    const metadata = await this.metadata();
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: bounded(input.code, "OIDC authorization code", 1, 4096),
      redirect_uri: this.callbackUri,
      client_id: this.clientId,
      code_verifier: flow.verifier,
    });
    const tokenResponse = await this.fetchImpl(metadata.token_endpoint, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(
          `${formComponent(this.clientId)}:${formComponent(this.clientSecret)}`,
        ).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!tokenResponse.ok)
      throw new AppError(
        "OIDC_TOKEN_EXCHANGE_FAILED",
        "OIDC login could not be completed",
        401,
      );
    const tokens = parseJsonObject(
      await readLimitedResponse(tokenResponse, MAXIMUM_TOKEN_BYTES),
      "OIDC token response",
    );
    if (typeof tokens.id_token !== "string")
      throw new AppError(
        "OIDC_ID_TOKEN_MISSING",
        "OIDC login did not return an ID token",
        401,
      );
    this.jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri), {
      [customFetch]: this.boundedJwksFetch(),
      timeoutDuration: 10_000,
    });
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(tokens.id_token, this.jwks, {
        issuer: this.issuer,
        audience: this.clientId,
        algorithms: [...this.algorithms],
        clockTolerance: 5,
        maxTokenAge: "10m",
      }));
    } catch {
      throw new AppError(
        "OIDC_ID_TOKEN_INVALID",
        "OIDC ID token is invalid",
        401,
      );
    }
    if (
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      payload.sub.length > 500 ||
      hasControlCharacters(payload.sub) ||
      typeof payload.nonce !== "string" ||
      !safeEqual(payload.nonce, flow.nonce) ||
      typeof payload.exp !== "number" ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp <= 0 ||
      payload.exp > MAXIMUM_EXP_SECONDS ||
      (Array.isArray(payload.aud) &&
        payload.aud.length > 1 &&
        payload.azp !== this.clientId)
    )
      throw new AppError(
        "OIDC_ID_TOKEN_INVALID",
        "OIDC ID token is invalid",
        401,
      );
    const name = optionalClaim(payload.name, 500);
    const preferredUsername = optionalClaim(payload.preferred_username, 500);
    const email =
      payload.email_verified === true
        ? optionalClaim(payload.email, 320)
        : undefined;
    return {
      identity: {
        provider: "oidc",
        issuer: this.issuer,
        subject: payload.sub,
        ...(name ? { name } : {}),
        ...(preferredUsername ? { preferredUsername } : {}),
        ...(email ? { email } : {}),
        expiresAt: new Date(payload.exp * 1000).toISOString(),
        payload,
      },
      returnTo: flow.returnTo,
    };
  }

  private async metadata(): Promise<OidcMetadata> {
    if (this.metadataPromise === undefined) {
      const pending = this.loadMetadata();
      this.metadataPromise = pending;
      try {
        return await pending;
      } catch (error) {
        // Discovery failures are commonly transient. Do not permanently
        // poison this process with a rejected promise.
        if (this.metadataPromise === pending) this.metadataPromise = undefined;
        throw error;
      }
    }
    return this.metadataPromise;
  }

  private async loadMetadata(): Promise<OidcMetadata> {
    const discovery = new URL(this.issuer);
    discovery.pathname = `${discovery.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const response = await this.fetchImpl(discovery, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`OIDC discovery failed with HTTP ${response.status}`);
    const value = parseJsonObject(
      await readLimitedResponse(response, MAXIMUM_DISCOVERY_BYTES),
      "OIDC discovery document",
    ) as unknown as OidcMetadata;
    if (value.issuer !== this.issuer)
      throw new Error(
        "OIDC discovery issuer does not exactly match OIDC_ISSUER",
      );
    value.authorization_endpoint = strictHttpsUrl(
      value.authorization_endpoint,
      "OIDC authorization endpoint",
    );
    value.token_endpoint = strictHttpsUrl(
      value.token_endpoint,
      "OIDC token endpoint",
    );
    value.jwks_uri = strictHttpsUrl(value.jwks_uri, "OIDC JWKS endpoint");
    if (
      !arrayIncludes(value.response_types_supported, "code") ||
      !arrayIncludes(value.code_challenge_methods_supported, "S256") ||
      !arrayIncludes(
        value.token_endpoint_auth_methods_supported,
        "client_secret_basic",
      )
    )
      throw new Error(
        "OIDC provider must support code, PKCE S256, and client_secret_basic",
      );
    return value;
  }

  private pruneFlows(): void {
    const now = this.now().getTime();
    for (const [key, flow] of this.flows)
      if (flow.expiresAt <= now) this.flows.delete(key);
    if (this.flows.size >= 1_000)
      throw new AppError(
        "OIDC_LOGIN_BUSY",
        "Too many OIDC login attempts are pending",
        503,
      );
  }

  private consumeFlowStart(clientAddress: string): void {
    const now = this.now().getTime();
    for (const [key, window] of this.flowStartWindows) {
      if (window.windowStartedAt + FLOW_START_WINDOW_MS <= now)
        this.flowStartWindows.delete(key);
    }
    const key = hash(clientAddress.trim() || "unavailable");
    let window = this.flowStartWindows.get(key);
    if (window === undefined) {
      if (this.flowStartWindows.size >= MAXIMUM_FLOW_START_RATE_KEYS) {
        const oldest = this.flowStartWindows.keys().next().value;
        if (typeof oldest === "string") this.flowStartWindows.delete(oldest);
      }
      window = { windowStartedAt: now, count: 0 };
      this.flowStartWindows.set(key, window);
    }
    if (window.count >= MAXIMUM_FLOW_STARTS_PER_CLIENT)
      throw new AppError(
        "OIDC_LOGIN_RATE_LIMITED",
        "Too many OIDC login attempts; try again later",
        429,
      );
    window.count += 1;
  }

  private boundedJwksFetch(): typeof fetch {
    return async (input, init) => {
      const timeout = AbortSignal.timeout(10_000);
      const signal = init?.signal
        ? AbortSignal.any([init.signal, timeout])
        : timeout;
      const response = await this.fetchImpl(input, {
        ...init,
        redirect: "error",
        signal,
      });
      if (!response.ok) return response;
      const body = await readLimitedResponse(response, MAXIMUM_JWKS_BYTES);
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  }
}

export function safeReturnTo(value: string): string {
  if (
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    hasControlCharacters(value)
  )
    return "/app/";
  const url = new URL(value, "https://return.invalid");
  if (url.origin !== "https://return.invalid") return "/app/";
  return `${url.pathname}${url.search}${url.hash}`;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function strictHttpsOrigin(value: string, label: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(`${label} must be an exact HTTPS origin`);
  return url.origin;
}

function strictHttpsUrl(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(
      `${label} must be an HTTPS URL without credentials, query, or fragment`,
    );
  return url.toString();
}

function bounded(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (value.length < minimum || value.length > maximum)
    throw new Error(`${label} length is invalid`);
  return value;
}

function optionalClaim(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !hasControlCharacters(value)
    ? value
    : undefined;
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashBase64Url(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function arrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.includes(expected);
}

function formComponent(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

async function readLimitedResponse(
  response: Response,
  maximum: number,
): Promise<string> {
  const declared = response.headers.get("Content-Length");
  if (declared !== null && Number(declared) > maximum)
    throw new Error("OIDC response is too large");
  if (response.body === null) throw new Error("OIDC response body is missing");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error("OIDC response is too large");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} is not a JSON object`);
  return value as Record<string, unknown>;
}
