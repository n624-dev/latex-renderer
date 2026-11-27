import { createHash } from "node:crypto";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  jwtVerify,
  type JSONWebKeySet,
} from "jose";
import { requestHttpsJson, type HttpsJsonClient } from "./https-json.js";

export const jwtClientAssertionType =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

export const dcrClientRetentionMs = 7 * 86_400_000;
export const expiredConnectionRetentionMs = 7 * 86_400_000;

export interface DcrClientRegistration {
  clientName: string;
  redirectUris: string[];
}

export interface DcrClient extends DcrClientRegistration {
  id: string;
}

export interface DcrClientStore {
  registerDcrClient(
    registration: DcrClientRegistration,
    capacity: number,
    now: number,
  ): DcrClient | undefined;
  dcrClient(id: string): DcrClient | undefined;
}

/** Callbacks are supplied by the deployment configuration or review environment. */
export function parseDcrClientRegistration(
  body: unknown,
  allowedRedirectUris: ReadonlySet<string>,
): DcrClientRegistration {
  if (
    !isObject(body) ||
    (body.token_endpoint_auth_method !== undefined &&
      body.token_endpoint_auth_method !== "none") ||
    (body.grant_types !== undefined && !validGrantTypes(body.grant_types)) ||
    (body.response_types !== undefined && !onlyCode(body.response_types))
  )
    throw new Error("Unsupported public OAuth client registration");
  const redirectUris = approvedRedirects(
    body.redirect_uris,
    allowedRedirectUris,
  );
  const clientName =
    body.client_name === undefined
      ? "OAuth client"
      : nonemptyString(body.client_name);
  return { clientName, redirectUris };
}

export interface CimdClientTrust {
  redirectUris: ReadonlySet<string>;
  jwksUri: string;
}

export interface CimdClient {
  id: string;
  clientName: string;
  redirectUris: readonly string[];
  jwksUri: string;
}

interface HttpsLimits {
  signal: AbortSignal;
  maxResponseBytes: number;
}

export async function readCimdClient(
  clientId: string,
  clients: ReadonlyMap<string, CimdClientTrust>,
  limits: HttpsLimits,
  request: HttpsJsonClient = requestHttpsJson,
): Promise<CimdClient> {
  const trust = clients.get(clientId);
  if (trust === undefined) throw new Error("Unregistered CIMD client document");
  const clientUrl = new URL(clientId);
  const expectedJwks = new URL(trust.jwksUri);
  if (
    !safeHttpsUrl(clientId) ||
    !safeHttpsUrl(trust.jwksUri) ||
    expectedJwks.origin !== clientUrl.origin
  )
    throw new Error("Invalid CIMD client configuration");
  const metadata = await request({
    url: clientUrl,
    trustedOrigin: clientUrl.origin,
    ...limits,
  });
  if (
    !isObject(metadata) ||
    metadata.client_id !== clientId ||
    metadata.jwks_uri !== trust.jwksUri ||
    !supportsPrivateKeyJwt(metadata) ||
    (metadata.token_endpoint_auth_signing_alg !== undefined &&
      metadata.token_endpoint_auth_signing_alg !== "RS256") ||
    !Array.isArray(metadata.grant_types) ||
    !metadata.grant_types.includes("authorization_code") ||
    !onlyCode(metadata.response_types)
  )
    throw new Error("Unexpected CIMD client metadata");
  return {
    id: clientId,
    clientName: nonemptyString(metadata.client_name),
    redirectUris: approvedRedirects(metadata.redirect_uris, trust.redirectUris),
    jwksUri: trust.jwksUri,
  };
}

export async function verifyCimdClientAssertion(
  client: CimdClient,
  form: URLSearchParams,
  options: HttpsLimits & {
    audience: string;
    now: number;
    maxLifetimeSeconds: number;
    claimAssertion: (hash: string, expiresAt: number, now: number) => boolean;
  },
  request: HttpsJsonClient = requestHttpsJson,
): Promise<void> {
  const assertions = form.getAll("client_assertion");
  const types = form.getAll("client_assertion_type");
  const identifiers = form.getAll("client_id");
  const assertion = assertions[0];
  if (
    assertions.length !== 1 ||
    !assertion ||
    types.length !== 1 ||
    types[0] !== jwtClientAssertionType ||
    identifiers.length > 1 ||
    (identifiers.length === 1 && identifiers[0] !== client.id)
  )
    throw new Error("OAuth client assertion is required");
  try {
    const header = decodeProtectedHeader(assertion);
    if (header.alg !== "RS256" || typeof header.kid !== "string" || !header.kid)
      throw new Error("Invalid signature header");
    const jwks = await request({
      url: new URL(client.jwksUri),
      trustedOrigin: new URL(client.id).origin,
      maxResponseBytes: options.maxResponseBytes,
      signal: options.signal,
    });
    if (!isObject(jwks) || !Array.isArray(jwks.keys))
      throw new Error("Invalid public key set");
    const nowSeconds = Math.floor(options.now / 1000);
    const { payload } = await jwtVerify(
      assertion,
      createLocalJWKSet(jwks as unknown as JSONWebKeySet),
      {
        algorithms: ["RS256"],
        issuer: client.id,
        subject: client.id,
        audience: options.audience,
        currentDate: new Date(options.now),
        requiredClaims: ["exp"],
      },
    );
    if (
      !Number.isSafeInteger(options.maxLifetimeSeconds) ||
      options.maxLifetimeSeconds < 1 ||
      !Number.isSafeInteger(payload.exp) ||
      payload.exp === undefined ||
      payload.exp > nowSeconds + options.maxLifetimeSeconds ||
      (payload.iat !== undefined &&
        (!Number.isSafeInteger(payload.iat) ||
          payload.iat > nowSeconds ||
          payload.exp - payload.iat > options.maxLifetimeSeconds))
    )
      throw new Error("Invalid assertion lifetime");
    if (
      payload.jti !== undefined &&
      (typeof payload.jti !== "string" || !payload.jti)
    )
      throw new Error("Invalid assertion identifier");
    const identity =
      payload.jti === undefined ? ["jwt", assertion] : ["jti", payload.jti];
    const hash = createHash("sha256")
      .update(JSON.stringify([client.id, ...identity]))
      .digest("hex");
    if (!options.claimAssertion(hash, payload.exp * 1000, options.now))
      throw new Error("Client assertion has already been used");
  } catch {
    throw new Error("OAuth client assertion could not be verified");
  }
}

function supportsPrivateKeyJwt(metadata: Record<string, unknown>): boolean {
  const methods = metadata.token_endpoint_auth_methods_supported;
  return methods === undefined
    ? metadata.token_endpoint_auth_method === "private_key_jwt"
    : Array.isArray(methods) && methods.includes("private_key_jwt");
}

function validGrantTypes(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.includes("authorization_code") &&
    value.every(
      (method) => method === "authorization_code" || method === "refresh_token",
    )
  );
}

function onlyCode(value: unknown): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === "code";
}

function approvedRedirects(
  value: unknown,
  allowed: ReadonlySet<string>,
): string[] {
  if (
    !Array.isArray(value) ||
    !value.length ||
    !value.every(
      (uri): uri is string =>
        typeof uri === "string" && allowed.has(uri) && safeHttpsUrl(uri),
    )
  )
    throw new Error("OAuth client redirect URI is not allowed");
  return [...new Set(value)];
}

function safeHttpsUrl(value: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.protocol === "https:" &&
    url.port === "" &&
    !url.username &&
    !url.password &&
    !url.hash &&
    url.href === value
  );
}

function nonemptyString(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Invalid OAuth client display name");
  for (const char of value) {
    if (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
      throw new Error("Invalid OAuth client display name");
  }
  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
