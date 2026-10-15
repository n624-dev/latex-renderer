-- Internal diagnostics remain available to local operators, but are not user resources.
BEGIN IMMEDIATE;
ALTER TABLE service_accounts ADD COLUMN purpose TEXT NOT NULL DEFAULT 'user'
  CHECK(purpose IN ('user','production-smoke'));
ALTER TABLE sources ADD COLUMN purpose TEXT NOT NULL DEFAULT 'user'
  CHECK(purpose IN ('user','production-smoke'));

-- Do not classify a user-created CI client by its name alone. Legacy smoke keys
-- have a local-only creator marker; all keys on the account must agree.
UPDATE service_accounts AS s SET purpose='production-smoke'
WHERE s.client_type='ci' AND s.name='production-smoke-' || s.id
  AND EXISTS (SELECT 1 FROM api_keys k WHERE k.service_account_id=s.id
    AND k.created_by='local-smoke-test' AND k.name='production-smoke')
  AND NOT EXISTS (SELECT 1 FROM api_keys k WHERE k.service_account_id=s.id
    AND (k.created_by!='local-smoke-test' OR k.name!='production-smoke'));

-- Previously shared input is still a user resource. Never hide a Project input
-- or an input referenced by an ordinary client, even if smoke also used it.
UPDATE sources AS s SET purpose='production-smoke'
WHERE (
  EXISTS (SELECT 1 FROM jobs j JOIN service_accounts a ON a.id=j.service_account_id
    WHERE j.source_id=s.id AND a.purpose='production-smoke')
  OR EXISTS (SELECT 1 FROM audit_logs l JOIN service_accounts a ON a.id=l.actor_id
    WHERE l.target_type='source' AND l.target_id=s.id AND l.action='source.reserved'
      AND l.actor_type='service_account' AND a.purpose='production-smoke')
)
AND NOT EXISTS (SELECT 1 FROM jobs j JOIN service_accounts a ON a.id=j.service_account_id
  WHERE j.source_id=s.id AND a.purpose='user')
AND NOT EXISTS (SELECT 1 FROM project_revisions r WHERE r.source_id=s.id);

CREATE INDEX idx_service_accounts_purpose ON service_accounts(purpose,id);
CREATE INDEX idx_sources_purpose ON sources(purpose,id);
INSERT INTO schema_migrations(version,applied_at)
VALUES (19,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
COMMIT;
