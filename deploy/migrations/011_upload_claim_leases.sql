ALTER TABLE used_nonces ADD COLUMN claim_expires_at TEXT;
UPDATE used_nonces SET claim_expires_at=expires_at WHERE state='claimed';

ALTER TABLE source_upload_nonces ADD COLUMN claim_expires_at TEXT;
UPDATE source_upload_nonces SET claim_expires_at=expires_at WHERE state='claimed';

CREATE INDEX idx_nonces_claim_expiry
ON used_nonces(state,claim_expires_at);
CREATE INDEX idx_source_nonces_claim_expiry
ON source_upload_nonces(state,claim_expires_at);

INSERT INTO schema_migrations(version,applied_at)
VALUES (11,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
