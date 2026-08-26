import { randomBytes } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  decodeProtectedHeader,
  jwtVerify,
  SignJWT,
  type JWTPayload,
} from "jose";
import type { RendererDatabase } from "@latex-renderer/database";
import { AppError, nowIso } from "@latex-renderer/shared";

export type TicketScope =
  "upload" | "status" | "download" | "cancel" | "delete";

export interface TicketSubject {
  jobId: string;
  userId: string;
  serviceAccountId: string;
  apiKeyId: string;
  userSecurityVersion: number;
  serviceAccountSecurityVersion: number;
}

export interface UploadTicketInput extends TicketSubject {
  size: number;
  sha256: string;
  nonce: string;
}
export interface SourceTicketSubject {
  sourceId: string;
  userId: string;
  serviceAccountId: string;
  apiKeyId: string;
  userSecurityVersion: number;
  serviceAccountSecurityVersion: number;
}
export interface SourceUploadTicketInput extends SourceTicketSubject {
  size: number;
  sha256: string;
  nonce: string;
}
export interface TicketClaims extends JWTPayload {
  job_id: string;
  user_id: string;
  service_account_id: string;
  api_key_id: string;
  user_security_version: number;
  service_account_security_version: number;
  scopes: TicketScope[];
  size?: number;
  sha256?: string;
  nonce?: string;
}
export interface SourceTicketClaims extends JWTPayload {
  source_id: string;
  user_id: string;
  service_account_id: string;
  api_key_id: string;
  user_security_version: number;
  service_account_security_version: number;
  scopes: TicketScope[];
  size: number;
  sha256: string;
  nonce: string;
}

export interface SigningKey {
  kid: string;
  secret: Uint8Array;
}

export function loadSigningKeyRing(
  activeKid: string,
  directory: string | undefined,
  activeFile: string | undefined,
): { active: SigningKey; verification: SigningKey[] } {
  if (directory === undefined && activeFile === undefined)
    throw new AppError(
      "TICKET_KEY_CONFIG_INVALID",
      "Ticket signing key directory or active file is required",
    );
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(activeKid))
    throw new AppError(
      "TICKET_KEY_CONFIG_INVALID",
      "Active ticket key id is invalid",
    );
  const active = {
    kid: activeKid,
    secret: readFileSync(
      activeFile ?? join(String(directory), `${activeKid}.key`),
    ),
  };
  if (directory === undefined) return { active, verification: [] };
  const verification = readdirSync(directory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /^[A-Za-z0-9._-]{1,100}\.key$/.test(entry.name) &&
        entry.name !== `${activeKid}.key`,
    )
    .map((entry) => ({
      kid: entry.name.slice(0, -4),
      secret: readFileSync(join(directory, entry.name)),
    }));
  return { active, verification };
}

export class TicketService {
  private readonly keys: ReadonlyMap<string, Uint8Array>;

  constructor(
    private readonly database: RendererDatabase,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly activeKey: SigningKey,
    verificationKeys: readonly SigningKey[],
  ) {
    if (
      activeKey.secret.byteLength < 32 ||
      verificationKeys.some((key) => key.secret.byteLength < 32)
    )
      throw new AppError(
        "TICKET_KEY_CONFIG_INVALID",
        "Ticket signing keys must contain at least 32 bytes",
      );
    if (
      new Set([activeKey.kid, ...verificationKeys.map((key) => key.kid)])
        .size !==
      verificationKeys.length + 1
    )
      throw new AppError(
        "TICKET_KEY_CONFIG_INVALID",
        "Ticket signing key ids must be unique",
      );
    this.keys = new Map(
      [activeKey, ...verificationKeys].map((key) => [key.kid, key.secret]),
    );
  }

  async issueUpload(
    subject: UploadTicketInput,
    ttlSeconds = 600,
  ): Promise<string> {
    return this.sign(subject, ["upload"], ttlSeconds, {
      size: subject.size,
      sha256: subject.sha256,
      nonce: subject.nonce,
    });
  }

  async issueSourceUpload(
    subject: SourceUploadTicketInput,
    ttlSeconds = 600,
  ): Promise<string> {
    const issued = Math.floor(Date.now() / 1000);
    return new SignJWT({
      source_id: subject.sourceId,
      user_id: subject.userId,
      service_account_id: subject.serviceAccountId,
      api_key_id: subject.apiKeyId,
      user_security_version: subject.userSecurityVersion,
      service_account_security_version: subject.serviceAccountSecurityVersion,
      scopes: ["upload"],
      size: subject.size,
      sha256: subject.sha256,
      nonce: subject.nonce,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: this.activeKey.kid })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(issued)
      .setExpirationTime(issued + ttlSeconds)
      .setJti(randomBytes(16).toString("hex"))
      .sign(this.activeKey.secret);
  }

  async issueJob(subject: TicketSubject, ttlSeconds = 1800): Promise<string> {
    return this.sign(
      subject,
      ["status", "download", "cancel", "delete"],
      ttlSeconds,
    );
  }

  async verify(
    token: string,
    requiredScope: TicketScope,
    expectedJobId: string,
  ): Promise<TicketClaims> {
    let protectedHeader: ReturnType<typeof decodeProtectedHeader>;
    try {
      protectedHeader = decodeProtectedHeader(token);
    } catch {
      throw new AppError("INVALID_TICKET", "Ticket is invalid or expired", 401);
    }
    if (typeof protectedHeader.kid !== "string")
      throw new AppError("TICKET_KID_MISSING", "Ticket key id is missing", 401);
    const revokedKid = this.database.raw
      .prepare(
        `SELECT 1 FROM revoked_tickets
      WHERE selector_type='kid' AND selector_value=? AND expires_at>?`,
      )
      .get(protectedHeader.kid, nowIso());
    if (revokedKid !== undefined)
      throw new AppError(
        "TICKET_REVOKED",
        "Ticket signing key is revoked",
        401,
      );
    const key = this.keys.get(protectedHeader.kid);
    if (key === undefined)
      throw new AppError(
        "TICKET_KEY_UNKNOWN",
        "Ticket signing key is unknown",
        401,
      );
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["HS256"],
      }));
    } catch {
      throw new AppError("INVALID_TICKET", "Ticket is invalid or expired", 401);
    }
    const claims = validateClaims(payload);
    if (claims.job_id !== expectedJobId)
      throw new AppError(
        "TICKET_JOB_MISMATCH",
        "Ticket does not match job",
        403,
      );
    if (!claims.scopes.includes(requiredScope))
      throw new AppError(
        "TICKET_SCOPE_MISSING",
        "Ticket scope is insufficient",
        403,
      );
    if (typeof claims.jti !== "string")
      throw new AppError("TICKET_JTI_MISSING", "Ticket id is missing", 401);
    const revokedJti = this.database.raw
      .prepare(
        `SELECT 1 FROM revoked_tickets
      WHERE selector_type='jti' AND selector_value=? AND expires_at>?`,
      )
      .get(claims.jti, nowIso());
    if (revokedJti !== undefined)
      throw new AppError("TICKET_REVOKED", "Ticket is revoked", 401);
    this.revalidateSubject(claims);
    return claims;
  }

  async verifySourceUpload(
    token: string,
    expectedSourceId: string,
  ): Promise<SourceTicketClaims> {
    const payload = await this.verifiedPayload(token);
    const claims = validateSourceClaims(payload);
    if (claims.source_id !== expectedSourceId)
      throw new AppError(
        "TICKET_SOURCE_MISMATCH",
        "Ticket does not match source",
        403,
      );
    if (!claims.scopes.includes("upload"))
      throw new AppError(
        "TICKET_SCOPE_MISSING",
        "Ticket scope is insufficient",
        403,
      );
    this.revalidateSourceSubject(claims);
    return claims;
  }

  private async verifiedPayload(token: string): Promise<JWTPayload> {
    let protectedHeader: ReturnType<typeof decodeProtectedHeader>;
    try {
      protectedHeader = decodeProtectedHeader(token);
    } catch {
      throw new AppError("INVALID_TICKET", "Ticket is invalid or expired", 401);
    }
    if (typeof protectedHeader.kid !== "string")
      throw new AppError("TICKET_KID_MISSING", "Ticket key id is missing", 401);
    const revokedKid = this.database.raw
      .prepare(
        `SELECT 1 FROM revoked_tickets WHERE selector_type='kid' AND selector_value=? AND expires_at>?`,
      )
      .get(protectedHeader.kid, nowIso());
    if (revokedKid !== undefined)
      throw new AppError(
        "TICKET_REVOKED",
        "Ticket signing key is revoked",
        401,
      );
    const key = this.keys.get(protectedHeader.kid);
    if (key === undefined)
      throw new AppError(
        "TICKET_KEY_UNKNOWN",
        "Ticket signing key is unknown",
        401,
      );
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, key, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ["HS256"],
      }));
    } catch {
      throw new AppError("INVALID_TICKET", "Ticket is invalid or expired", 401);
    }
    if (typeof payload.jti !== "string")
      throw new AppError("TICKET_JTI_MISSING", "Ticket id is missing", 401);
    const revokedJti = this.database.raw
      .prepare(
        `SELECT 1 FROM revoked_tickets WHERE selector_type='jti' AND selector_value=? AND expires_at>?`,
      )
      .get(payload.jti, nowIso());
    if (revokedJti !== undefined)
      throw new AppError("TICKET_REVOKED", "Ticket is revoked", 401);
    return payload;
  }

  private async sign(
    subject: TicketSubject,
    scopes: TicketScope[],
    ttlSeconds: number,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const issued = Math.floor(Date.now() / 1000);
    return new SignJWT({
      job_id: subject.jobId,
      user_id: subject.userId,
      service_account_id: subject.serviceAccountId,
      api_key_id: subject.apiKeyId,
      user_security_version: subject.userSecurityVersion,
      service_account_security_version: subject.serviceAccountSecurityVersion,
      scopes,
      ...extra,
    })
      .setProtectedHeader({ alg: "HS256", typ: "JWT", kid: this.activeKey.kid })
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setIssuedAt(issued)
      .setExpirationTime(issued + ttlSeconds)
      .setJti(randomBytes(16).toString("hex"))
      .sign(this.activeKey.secret);
  }

  private revalidateSubject(claims: TicketClaims): void {
    const row = this.database.raw
      .prepare(
        `SELECT j.status,u.status AS user_status,u.security_version AS user_sv,
      s.status AS sa_status,s.security_version AS sa_sv,k.revoked_at,k.expires_at
      FROM jobs j JOIN users u ON u.id=j.user_id JOIN service_accounts s ON s.id=j.service_account_id
      JOIN api_keys k ON k.id=j.api_key_id WHERE j.id=? AND j.user_id=? AND j.service_account_id=? AND j.api_key_id=?`,
      )
      .get(
        claims.job_id,
        claims.user_id,
        claims.service_account_id,
        claims.api_key_id,
      ) as
      | {
          status: string;
          user_status: string;
          user_sv: number;
          sa_status: string;
          sa_sv: number;
          revoked_at: string | null;
          expires_at: string | null;
        }
      | undefined;
    if (row === undefined || row.status === "deleted")
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    if (
      row.user_status !== "active" ||
      row.sa_status !== "active" ||
      row.revoked_at !== null ||
      (row.expires_at !== null && row.expires_at <= nowIso())
    ) {
      throw new AppError(
        "TICKET_SUBJECT_INACTIVE",
        "Ticket subject is inactive",
        401,
      );
    }
    if (
      row.user_sv !== claims.user_security_version ||
      row.sa_sv !== claims.service_account_security_version
    ) {
      throw new AppError(
        "TICKET_SECURITY_VERSION_CHANGED",
        "Ticket security version is stale",
        401,
      );
    }
  }

  private revalidateSourceSubject(claims: SourceTicketClaims): void {
    const row = this.database.raw
      .prepare(
        `SELECT src.status,u.status AS user_status,u.security_version AS user_sv,
      s.status AS sa_status,s.security_version AS sa_sv,k.revoked_at,k.expires_at
      FROM sources src JOIN users u ON u.id=src.owner_user_id
      JOIN service_accounts s ON s.owner_user_id=u.id JOIN api_keys k ON k.service_account_id=s.id
      WHERE src.id=? AND src.owner_user_id=? AND s.id=? AND k.id=?`,
      )
      .get(
        claims.source_id,
        claims.user_id,
        claims.service_account_id,
        claims.api_key_id,
      ) as
      | {
          status: string;
          user_status: string;
          user_sv: number;
          sa_status: string;
          sa_sv: number;
          revoked_at: string | null;
          expires_at: string | null;
        }
      | undefined;
    if (
      row === undefined ||
      row.status === "deleted" ||
      row.status === "expired"
    )
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    if (
      row.user_status !== "active" ||
      row.sa_status !== "active" ||
      row.revoked_at !== null ||
      (row.expires_at !== null && row.expires_at <= nowIso())
    )
      throw new AppError(
        "TICKET_SUBJECT_INACTIVE",
        "Ticket subject is inactive",
        401,
      );
    if (
      row.user_sv !== claims.user_security_version ||
      row.sa_sv !== claims.service_account_security_version
    )
      throw new AppError(
        "TICKET_SECURITY_VERSION_CHANGED",
        "Ticket security version is stale",
        401,
      );
  }
}

function validateClaims(payload: JWTPayload): TicketClaims {
  const stringFields = [
    "job_id",
    "user_id",
    "service_account_id",
    "api_key_id",
  ] as const;
  for (const field of stringFields) {
    if (typeof payload[field] !== "string")
      throw new AppError(
        "INVALID_TICKET_CLAIMS",
        `Ticket ${field} is invalid`,
        401,
      );
  }
  if (
    typeof payload.user_security_version !== "number" ||
    typeof payload.service_account_security_version !== "number"
  ) {
    throw new AppError(
      "INVALID_TICKET_CLAIMS",
      "Ticket security versions are invalid",
      401,
    );
  }
  if (
    !Array.isArray(payload.scopes) ||
    !payload.scopes.every((scope) => typeof scope === "string")
  ) {
    throw new AppError(
      "INVALID_TICKET_CLAIMS",
      "Ticket scopes are invalid",
      401,
    );
  }
  return payload as TicketClaims;
}

function validateSourceClaims(payload: JWTPayload): SourceTicketClaims {
  for (const field of [
    "source_id",
    "user_id",
    "service_account_id",
    "api_key_id",
    "sha256",
    "nonce",
  ] as const) {
    if (typeof payload[field] !== "string")
      throw new AppError(
        "INVALID_TICKET_CLAIMS",
        `Ticket ${field} is invalid`,
        401,
      );
  }
  if (
    typeof payload.user_security_version !== "number" ||
    typeof payload.service_account_security_version !== "number" ||
    typeof payload.size !== "number"
  )
    throw new AppError(
      "INVALID_TICKET_CLAIMS",
      "Ticket source claims are invalid",
      401,
    );
  if (
    !Array.isArray(payload.scopes) ||
    !payload.scopes.every((scope) => typeof scope === "string")
  )
    throw new AppError(
      "INVALID_TICKET_CLAIMS",
      "Ticket scopes are invalid",
      401,
    );
  return payload as SourceTicketClaims;
}
