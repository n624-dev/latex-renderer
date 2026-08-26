import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import type { RendererDatabase } from "@latex-renderer/database";
import { AppError, nowIso } from "@latex-renderer/shared";

export interface AuthenticatedServiceAccount {
  apiKeyId: string;
  serviceAccountId: string;
  userId: string;
  userSecurityVersion: number;
  serviceAccountSecurityVersion: number;
  scopes: readonly string[];
  keyKind: "render" | "admin";
}

interface ApiKeyRow {
  id: string;
  service_account_id: string;
  secret_hash: string;
  pepper_id: string;
  scopes_json: string;
  expires_at: string | null;
  revoked_at: string | null;
  service_account_status: string;
  service_account_security_version: number;
  owner_user_id: string;
  user_status: string;
  user_security_version: number;
}

export class ApiKeyService {
  constructor(
    private readonly database: RendererDatabase,
    private readonly peppers: ReadonlyMap<string, Uint8Array>,
    private readonly activePepperId: string,
  ) {
    if (!peppers.has(activePepperId)) throw new AppError("PEPPER_CONFIG_INVALID", "Active API key pepper is missing");
  }

  create(kind: "render" | "admin"): { token: string; id: string; prefix: string; secretHash: string; pepperId: string } {
    const keyId = randomBytes(16).toString("hex");
    const secret = randomBytes(32).toString("base64url");
    const prefix = kind === "render" ? "lrk" : "lra";
    const token = `${prefix}_${keyId}_${secret}`;
    return {
      token,
      id: `key_${keyId}`,
      prefix: `${prefix}_${keyId}`,
      secretHash: this.hash(secret, this.activePepperId),
      pepperId: this.activePepperId,
    };
  }

  authenticate(token: string, requiredScope?: string): AuthenticatedServiceAccount {
    const parsed = /^(lrk|lra)_([a-f0-9]{32})_([A-Za-z0-9_-]{43})$/.exec(token);
    if (parsed === null) throw new AppError("INVALID_API_KEY", "API key is invalid", 401);
    const kind = parsed[1] === "lrk" ? "render" : "admin";
    const id = `key_${String(parsed[2])}`;
    const secret = String(parsed[3]);
    const row = this.database.raw.prepare(`SELECT k.id,k.service_account_id,k.secret_hash,k.pepper_id,k.scopes_json,
      k.expires_at,k.revoked_at,s.status AS service_account_status,s.security_version AS service_account_security_version,
      s.owner_user_id,u.status AS user_status,u.security_version AS user_security_version
      FROM api_keys k JOIN service_accounts s ON s.id=k.service_account_id JOIN users u ON u.id=s.owner_user_id
      WHERE k.id=?`).get(id) as ApiKeyRow | undefined;
    if (row === undefined || !this.verify(secret, row.secret_hash, row.pepper_id)) {
      throw new AppError("INVALID_API_KEY", "API key is invalid", 401);
    }
    if (row.revoked_at !== null || (row.expires_at !== null && row.expires_at <= nowIso())) {
      throw new AppError("API_KEY_INACTIVE", "API key is expired or revoked", 401);
    }
    if (row.service_account_status !== "active" || row.user_status !== "active") {
      throw new AppError("ACCOUNT_DISABLED", "Account is disabled", 403);
    }
    const scopes = JSON.parse(row.scopes_json) as unknown;
    if (!Array.isArray(scopes) || !scopes.every((scope): scope is string => typeof scope === "string")) {
      throw new AppError("INVALID_SCOPE_DATA", "Stored API key scopes are invalid");
    }
    if (requiredScope !== undefined && !scopes.includes(requiredScope) && !scopes.includes("admin:*")) {
      throw new AppError("INSUFFICIENT_SCOPE", "API key lacks the required scope", 403);
    }
    this.database.raw.prepare("UPDATE api_keys SET last_used_at=? WHERE id=?").run(nowIso(), row.id);
    return {
      apiKeyId: row.id,
      serviceAccountId: row.service_account_id,
      userId: row.owner_user_id,
      userSecurityVersion: row.user_security_version,
      serviceAccountSecurityVersion: row.service_account_security_version,
      scopes,
      keyKind: kind,
    };
  }

  private hash(secret: string, pepperId: string): string {
    const pepper = this.peppers.get(pepperId);
    if (pepper === undefined) throw new AppError("PEPPER_NOT_FOUND", "API key pepper is unavailable");
    return createHmac("sha256", pepper).update(secret).digest("hex");
  }

  private verify(secret: string, expectedHex: string, pepperId: string): boolean {
    const actual = Buffer.from(this.hash(secret, pepperId), "hex");
    const expected = Buffer.from(expectedHex, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}

export interface AccessIdentity { subject: string; email?: string; payload: JWTPayload }

export class AccessJwtVerifier {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly issuer: string, private readonly audience: string) {
    const base = issuer.endsWith("/") ? issuer : `${issuer}/`;
    this.jwks = createRemoteJWKSet(new URL("cdn-cgi/access/certs", base));
  }

  async verify(assertion: string): Promise<AccessIdentity> {
    const payload = await this.verifyPayload(assertion);
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new AppError("ACCESS_SUBJECT_MISSING", "Access token subject is missing", 401);
    }
    const email = typeof payload.email === "string" ? payload.email : undefined;
    return email === undefined ? { subject: payload.sub, payload } : { subject: payload.sub, email, payload };
  }

  async verifyService(assertion: string, expectedCommonName: string): Promise<JWTPayload> {
    const payload = await this.verifyPayload(assertion);
    if (payload.sub !== "" || payload.common_name !== expectedCommonName) {
      throw new AppError("ACCESS_SERVICE_IDENTITY_INVALID", "Access service identity is invalid", 401);
    }
    return payload;
  }

  private async verifyPayload(assertion: string): Promise<JWTPayload> {
    try {
      const { payload } = await jwtVerify(assertion, this.jwks, { issuer: this.issuer, audience: this.audience });
      if (payload.type !== "app") throw new AppError("INVALID_ACCESS_TOKEN", "Cloudflare Access token is invalid", 401);
      return payload;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("INVALID_ACCESS_TOKEN", "Cloudflare Access token is invalid", 401);
    }
  }
}
