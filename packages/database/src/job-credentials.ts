import type { DatabaseSync } from "node:sqlite";

// These fragments use only aliases supplied by database repositories.
export function jobCredentialId(alias: string): string {
  return `COALESCE(${alias}.rotation_root_id,${alias}.id)`;
}

export function sameJobCredential(original: string, current: string): string {
  return `${original}.service_account_id=${current}.service_account_id
    AND ${jobCredentialId(original)}=${jobCredentialId(current)}`;
}

export function jobTicketCredential(
  db: DatabaseSync,
  claims: {
    job_id: string;
    user_id: string;
    service_account_id: string;
    api_key_id: string;
  },
) {
  return db
    .prepare(
      `
    SELECT j.status,u.status AS user_status,u.security_version AS user_sv,
      s.status AS sa_status,s.security_version AS sa_sv,k.revoked_at,k.expires_at
    FROM jobs j JOIN users u ON u.id=j.user_id
    JOIN service_accounts s ON s.id=j.service_account_id AND s.owner_user_id=u.id
    JOIN api_keys owner ON owner.id=j.api_key_id AND owner.service_account_id=s.id
    JOIN api_keys k ON k.id=? AND ${sameJobCredential("owner", "k")}
    WHERE j.id=? AND j.user_id=? AND j.service_account_id=?
  `,
    )
    .get(
      claims.api_key_id,
      claims.job_id,
      claims.user_id,
      claims.service_account_id,
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
}
