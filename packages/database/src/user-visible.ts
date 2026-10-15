/** SQL fragments only accept repository-owned identifiers, never request input. */
export function userServiceAccountSql(column: string): string {
  return `${column} IN (SELECT id FROM service_accounts WHERE purpose='user')`;
}

export function userJobSql(alias = "jobs"): string {
  return userServiceAccountSql(`${alias}.service_account_id`);
}

/** The diagnostic log export is deliberately unfiltered; only its Web/API view is filtered. */
export const userAuditSql = `
  NOT (actor_type='service_account' AND actor_id IN
    (SELECT id FROM service_accounts WHERE purpose='production-smoke'))
  AND NOT (actor_type='api_key' AND actor_id IN
    (SELECT k.id FROM api_keys k JOIN service_accounts s ON s.id=k.service_account_id WHERE s.purpose='production-smoke'))
  AND NOT (target_type='service_account' AND target_id IN
    (SELECT id FROM service_accounts WHERE purpose='production-smoke'))
  AND NOT (target_type='api_key' AND target_id IN
    (SELECT k.id FROM api_keys k JOIN service_accounts s ON s.id=k.service_account_id WHERE s.purpose='production-smoke'))
  AND NOT (target_type IN ('job','render') AND target_id IN
    (SELECT j.id FROM jobs j JOIN service_accounts s ON s.id=j.service_account_id WHERE s.purpose='production-smoke'))
  AND NOT (target_type='source' AND target_id IN
    (SELECT id FROM sources WHERE purpose='production-smoke'))
  AND NOT (target_type='system' AND target_id='production-smoke')`;
