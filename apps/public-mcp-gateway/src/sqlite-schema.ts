export const connectionSchemaVersion = 3;
// SQLite application_id identifies the file independently of schema version.
export const connectionApplicationId = 0x4c524d43;

export const agentRevocationSchema = `
  CREATE TABLE agent_revocations (
    transport_id TEXT NOT NULL REFERENCES transports (id),
    local_grant_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    PRIMARY KEY (transport_id, local_grant_id)
  ) STRICT;
`;

export const connectionRetentionSchema = `
  ALTER TABLE oauth_dcr_clients ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE oauth_dcr_clients ADD COLUMN last_authorization_end INTEGER NOT NULL DEFAULT 0;
  UPDATE oauth_dcr_clients SET created_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
  ALTER TABLE oauth_consents ADD COLUMN client_id TEXT;
  ALTER TABLE authorizations ADD COLUMN oauth_client_id TEXT;
  UPDATE authorizations SET oauth_client_id = COALESCE(
    (SELECT client_id FROM oauth_families WHERE authorization_id = authorizations.id),
    (SELECT client_id FROM oauth_codes WHERE authorization_id = authorizations.id)
  );
  CREATE INDEX authorizations_oauth_client_idx ON authorizations (oauth_client_id);
  CREATE INDEX authorizations_expiry_idx ON authorizations (expires_at);
  CREATE INDEX oauth_consents_client_idx ON oauth_consents (client_id);
`;

export const connectionSchema = `
  CREATE TABLE instances (
    id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL UNIQUE
  ) STRICT;

  CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES instances (id),
    local_profile_id TEXT NOT NULL,
    display_name TEXT,
    UNIQUE (instance_id, local_profile_id),
    UNIQUE (id, instance_id)
  ) STRICT;

  CREATE TABLE transports (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL REFERENCES instances (id),
    kind TEXT NOT NULL CHECK (kind IN ('https', 'agent')),
    mcp_url TEXT,
    agent_public_key TEXT,
    disabled_at INTEGER,
    CHECK (
      (kind = 'https' AND mcp_url IS NOT NULL AND agent_public_key IS NULL) OR
      (kind = 'agent' AND mcp_url IS NULL AND agent_public_key IS NOT NULL)
    ),
    UNIQUE (id, instance_id),
    UNIQUE (agent_public_key)
  ) STRICT;

  CREATE TABLE authorizations (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    transport_id TEXT NOT NULL,
    local_grant_id TEXT NOT NULL,
    scopes TEXT NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
    expires_at INTEGER NOT NULL,
    reauth_required INTEGER NOT NULL DEFAULT 0 CHECK (reauth_required IN (0, 1)),
    revoked_at INTEGER,
    UNIQUE (instance_id, local_grant_id),
    FOREIGN KEY (profile_id, instance_id) REFERENCES profiles (id, instance_id),
    FOREIGN KEY (transport_id, instance_id) REFERENCES transports (id, instance_id)
  ) STRICT;

  CREATE TABLE https_credentials (
    authorization_id TEXT PRIMARY KEY REFERENCES authorizations (id),
    envelope TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation > 0)
  ) STRICT;

  CREATE INDEX authorizations_transport_idx ON authorizations (transport_id);

  CREATE TABLE agent_enrollment_nonces (
    hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX agent_enrollment_expiry_idx ON agent_enrollment_nonces (expires_at);

  CREATE TABLE client_assertions (
    hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX client_assertions_expiry_idx ON client_assertions (expires_at);

  CREATE TABLE oauth_dcr_clients (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    redirect_uris TEXT NOT NULL CHECK (json_valid(redirect_uris) AND json_type(redirect_uris) = 'array')
  ) STRICT;

  CREATE TABLE oauth_consents (
    id TEXT PRIMARY KEY,
    browser_hash TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX oauth_consents_expiry_idx ON oauth_consents (expires_at);

  CREATE TABLE agent_pairings (
    consent_id TEXT PRIMARY KEY REFERENCES oauth_consents (id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    scopes TEXT NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
    expires_at INTEGER NOT NULL,
    transport_id TEXT REFERENCES transports (id),
    local_profile_id TEXT,
    nonce TEXT,
    local_grant_id TEXT,
    approved_scopes TEXT CHECK (json_valid(approved_scopes) AND json_type(approved_scopes) = 'array')
  ) STRICT;

  CREATE TABLE agent_pairing_attempts (
    bucket TEXT NOT NULL,
    window_end INTEGER NOT NULL,
    count INTEGER NOT NULL,
    PRIMARY KEY (bucket, window_end)
  ) STRICT;
  CREATE INDEX agent_pairing_attempts_expiry_idx ON agent_pairing_attempts (window_end);

  CREATE TABLE oauth_codes (
    hash TEXT PRIMARY KEY,
    authorization_id TEXT NOT NULL UNIQUE REFERENCES authorizations (id),
    client_id TEXT NOT NULL,
    redirect_uri TEXT NOT NULL,
    resource TEXT NOT NULL,
    code_challenge TEXT NOT NULL,
    scopes TEXT NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX oauth_codes_expiry_idx ON oauth_codes (expires_at);

  CREATE TABLE oauth_families (
    authorization_id TEXT PRIMARY KEY REFERENCES authorizations (id),
    client_id TEXT NOT NULL,
    resource TEXT NOT NULL,
    current_sequence INTEGER NOT NULL DEFAULT 0
  ) STRICT;

  CREATE TABLE oauth_tokens (
    refresh_hash TEXT PRIMARY KEY,
    access_hash TEXT NOT NULL UNIQUE,
    authorization_id TEXT NOT NULL REFERENCES oauth_families (authorization_id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    scopes TEXT NOT NULL CHECK (json_valid(scopes) AND json_type(scopes) = 'array'),
    access_expires_at INTEGER NOT NULL,
    consumed_at INTEGER,
    UNIQUE (authorization_id, sequence)
  ) STRICT;
`;
