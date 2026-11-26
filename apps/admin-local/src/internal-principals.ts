import type { RendererDatabase } from "@latex-renderer/database";
import { AppError, nowIso } from "@latex-renderer/shared";

const principals = `
  WITH principals AS (
    SELECT 'web' AS channel,user_id,service_account_id,api_key_id FROM web_principals
    UNION ALL
    SELECT 'mcp' AS channel,user_id,service_account_id,api_key_id FROM remote_mcp_principals
  )`;

interface PrincipalRow {
  channel: "web" | "mcp";
  userId: string;
  accountId: string;
  keyId: string;
  userStatus: string | null;
  accountStatus: string | null;
  revokedAt: string | null;
  validMapping: number;
  activeOtherKeys: number;
}

function readPrincipals(
  database: RendererDatabase,
  now: string,
  keyId: string | null = null,
) {
  return database.raw
    .prepare(
      `${principals}
    SELECT p.channel,p.user_id AS userId,p.service_account_id AS accountId,p.api_key_id AS keyId,
           u.status AS userStatus,s.status AS accountStatus,k.revoked_at AS revokedAt,
           COALESCE(
             s.owner_user_id=p.user_id AND s.purpose='user'
             AND k.service_account_id=s.id AND k.kind='render'
             AND k.secret_hash=? AND k.expires_at IS NULL
             AND CASE p.channel
               WHEN 'web' THEN k.created_by='web-principal' AND k.pepper_id='web-principal'
                 AND k.prefix='web_'||substr(k.id,5)
               WHEN 'mcp' THEN k.created_by='remote_mcp' AND k.pepper_id='oauth-principal'
                 AND k.prefix='oauth_'||substr(k.id,5)
             END
             AND NOT EXISTS (
               SELECT 1 FROM principals q WHERE q.channel<>p.channel
                 AND (q.service_account_id=p.service_account_id OR q.api_key_id=p.api_key_id)
             ),0
           ) AS validMapping,
           (SELECT COUNT(*) FROM api_keys other WHERE other.service_account_id=s.id
             AND other.id<>p.api_key_id AND other.revoked_at IS NULL
             AND (other.expires_at IS NULL OR other.expires_at>?)) AS activeOtherKeys
    FROM principals p
    LEFT JOIN users u ON u.id=p.user_id
    LEFT JOIN service_accounts s ON s.id=p.service_account_id
    LEFT JOIN api_keys k ON k.id=p.api_key_id
    WHERE (? IS NULL OR p.api_key_id=?) ORDER BY p.user_id,p.channel
  `,
    )
    .all("0".repeat(64), now, keyId, keyId) as unknown as PrincipalRow[];
}

interface LegacyKey {
  keyId: string;
  userId: string;
  accountId: string;
  kind: "render" | "admin";
  revokedAt: string | null;
  expiresAt: string | null;
}

function readLegacyKeys(
  database: RendererDatabase,
  keyId: string | null = null,
) {
  return database.raw
    .prepare(
      `${principals}
    SELECT k.id AS keyId,s.owner_user_id AS userId,s.id AS accountId,
           k.kind,k.revoked_at AS revokedAt,k.expires_at AS expiresAt
    FROM api_keys k JOIN service_accounts s ON s.id=k.service_account_id
    WHERE s.id IN (SELECT service_account_id FROM principals)
      AND k.id NOT IN (SELECT api_key_id FROM principals)
      AND k.prefix=(CASE k.kind WHEN 'admin' THEN 'lra_' ELSE 'lrk_' END)||substr(k.id,5)
      AND (? IS NULL OR k.id=?)
    ORDER BY s.owner_user_id,k.id
  `,
    )
    .all(keyId, keyId) as unknown as LegacyKey[];
}

export function diagnoseInternalPrincipals(database: RendererDatabase) {
  return {
    issues: readPrincipals(database, nowIso())
      .filter(
        (row) =>
          !row.validMapping ||
          row.accountStatus !== "active" ||
          row.revokedAt !== null,
      )
      .map(({ validMapping, ...row }) => ({
        ...row,
        validMapping: validMapping === 1,
      })),
    legacyKeys: readLegacyKeys(database),
  };
}

export function repairInternalPrincipal(
  database: RendererDatabase,
  keyId: string,
  actorId: string,
) {
  return database.transaction(() => {
    const now = nowIso();
    const [row] = readPrincipals(database, now, keyId);
    if (!row?.validMapping || row.userStatus !== "active") {
      throw new AppError(
        "INTERNAL_PRINCIPAL_REPAIR_UNSAFE",
        "The internal mapping is inconsistent or its owner is disabled",
        409,
      );
    }
    if (row.accountStatus === "disabled" && row.activeOtherKeys > 0) {
      throw new AppError(
        "INTERNAL_PRINCIPAL_LEGACY_KEYS",
        "Retire the legacy keys before enabling this internal account",
        409,
      );
    }
    if (row.accountStatus === "active" && row.revokedAt === null) return false;
    database.raw
      .prepare(
        `
      UPDATE service_accounts SET status='active',security_version=security_version+1,updated_at=?
      WHERE id=? AND status='disabled'
    `,
      )
      .run(now, row.accountId);
    database.raw
      .prepare("UPDATE api_keys SET revoked_at=NULL WHERE id=?")
      .run(row.keyId);
    database.audit({
      actorType: "local",
      actorId,
      action: "internal_principal.repaired",
      targetType: "api_key",
      targetId: row.keyId,
      result: "success",
      metadata: { channel: row.channel, serviceAccountId: row.accountId },
    });
    return true;
  });
}

export function retireLegacyInternalAccountKey(
  database: RendererDatabase,
  keyId: string,
  replacementId: string,
  actorId: string,
) {
  return database.transaction(() => {
    const now = nowIso();
    const [old] = readLegacyKeys(database, keyId);
    if (!old)
      throw new AppError(
        "LEGACY_KEY_NOT_FOUND",
        "The key is not a legacy external credential on an internal account",
        404,
      );
    if (old.revokedAt !== null) return false;
    const replacement = database.apiKeys.get(replacementId);
    const identity = database.apiKeys.activeIdentity(replacementId, now);
    if (
      replacement?.kind !== old.kind ||
      identity?.user_id !== old.userId ||
      !database.serviceAccounts.activeExists(identity.service_account_id)
    ) {
      throw new AppError(
        "LEGACY_REPLACEMENT_INVALID",
        "The replacement must be an active key of the same kind on a separate external account for this owner",
        409,
      );
    }
    database.apiKeys.revoke(old.keyId, now);
    database.audit({
      actorType: "local",
      actorId,
      action: "api_key.legacy_retired",
      targetType: "api_key",
      targetId: old.keyId,
      result: "success",
      metadata: { replacementId },
    });
    return true;
  });
}
