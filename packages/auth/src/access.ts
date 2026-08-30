import {
  createRemoteJWKSet,
  customFetch,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { AppError } from "@latex-renderer/shared";

const MAXIMUM_ACCESS_ASSERTION_BYTES = 64 * 1024;
const MAXIMUM_JWKS_BYTES = 256 * 1024;
const MAXIMUM_EXP_SECONDS = 253_402_300_799;

export interface ExternalIdentity {
  provider: "cloudflare-access" | "oidc";
  issuer: string;
  subject: string;
  name?: string | undefined;
  preferredUsername?: string | undefined;
  email?: string | undefined;
  expiresAt?: string | undefined;
  payload: JWTPayload;
}

export type AccessIdentity = ExternalIdentity;

export class AccessJwtVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;
  readonly issuer: string;

  constructor(
    issuer: string,
    private readonly audience: string,
    fetchImpl: typeof fetch = globalThis.fetch,
  ) {
    const url = new URL(issuer);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.pathname !== "/" ||
      url.search !== "" ||
      url.hash !== "" ||
      audience.length < 1 ||
      audience.length > 500 ||
      hasControlCharacters(audience)
    )
      throw new Error("Cloudflare Access issuer or audience is invalid");
    this.issuer = url.origin;
    this.jwks = createRemoteJWKSet(
      new URL("cdn-cgi/access/certs", `${this.issuer}/`),
      {
        timeoutDuration: 10_000,
        [customFetch]: boundedJwksFetch(fetchImpl, "Cloudflare Access JWKS"),
      },
    );
  }

  async verify(assertion: string): Promise<AccessIdentity> {
    const payload = await this.verifyPayload(assertion);
    if (
      typeof payload.sub !== "string" ||
      payload.sub.length === 0 ||
      payload.sub.length > 500 ||
      hasControlCharacters(payload.sub)
    )
      throw new AppError(
        "ACCESS_SUBJECT_MISSING",
        "Access token subject is missing",
        401,
      );
    const email = optionalClaim(payload.email, 320);
    const name = optionalClaim(payload.name, 500);
    const preferredUsername = optionalClaim(payload.preferred_username, 500);
    return {
      provider: "cloudflare-access",
      issuer: this.issuer,
      subject: payload.sub,
      ...(name ? { name } : {}),
      ...(preferredUsername ? { preferredUsername } : {}),
      ...(email ? { email } : {}),
      expiresAt: new Date((payload.exp ?? 0) * 1000).toISOString(),
      payload,
    };
  }

  async verifyService(
    assertion: string,
    expectedCommonName: string,
  ): Promise<JWTPayload> {
    const payload = await this.verifyPayload(assertion);
    if (payload.sub !== "" || payload.common_name !== expectedCommonName)
      throw new AppError(
        "ACCESS_SERVICE_IDENTITY_INVALID",
        "Access service identity is invalid",
        401,
      );
    return payload;
  }

  private async verifyPayload(assertion: string): Promise<JWTPayload> {
    try {
      if (
        assertion.length < 16 ||
        Buffer.byteLength(assertion) > MAXIMUM_ACCESS_ASSERTION_BYTES
      )
        throw new Error("Cloudflare Access assertion size is invalid");
      const { payload } = await jwtVerify(assertion, this.jwks, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["RS256"],
        clockTolerance: 5,
      });
      if (
        payload.type !== "app" ||
        typeof payload.exp !== "number" ||
        !Number.isSafeInteger(payload.exp) ||
        payload.exp <= 0 ||
        payload.exp > MAXIMUM_EXP_SECONDS
      )
        throw new AppError(
          "INVALID_ACCESS_TOKEN",
          "Cloudflare Access token is invalid",
          401,
        );
      return payload;
    } catch (error) {
      if (error instanceof AppError) throw error;
      const failure = new AppError(
        "INVALID_ACCESS_TOKEN",
        "Cloudflare Access token is invalid",
        401,
      );
      failure.cause = error;
      throw failure;
    }
  }
}

function optionalClaim(value: unknown, maximum: number): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    !hasControlCharacters(value)
    ? value
    : undefined;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function boundedJwksFetch(
  fetchImpl: typeof fetch,
  label: string,
): typeof fetch {
  return async (input, init) => {
    const timeout = AbortSignal.timeout(10_000);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeout])
      : timeout;
    const response = await fetchImpl(input, {
      ...init,
      redirect: "error",
      signal,
    });
    if (!response.ok) return response;
    const body = await readLimitedResponse(response, MAXIMUM_JWKS_BYTES, label);
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

async function readLimitedResponse(
  response: Response,
  maximum: number,
  label: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = response.headers.get("Content-Length");
  if (declared !== null && Number(declared) > maximum)
    throw new Error(`${label} response is too large`);
  if (response.body === null)
    throw new Error(`${label} response body is missing`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximum) {
      await reader.cancel();
      throw new Error(`${label} response is too large`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(new ArrayBuffer(length));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
