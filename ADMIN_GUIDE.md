# Administrator guide

`/admin/` is exclusively for human users with the database role `owner` or `admin`.

- `owner`: role changes, owner lifecycle, admin-key issuance/rotation, ticket-key revocation, and all normal operations.
- `admin`: daily user, client, render-key, job, worker, maintenance, and audit operations, subject to protected owner-only actions.
- `user`: uses `/app/`, Remote MCP or CLI/Local MCP, but never `/admin/`.

The Web UI covers dashboard/client registration, users, service accounts, API keys, jobs, worker control, maintenance, and audit logs. Admin CLI remains available for automation and advanced remote operations. Admin Local remains for break-glass recovery when network or Access authentication is unavailable.

## User authentication and registration

Choose the identity explicitly: a local password login or the verified subject
of the configured external provider. Email alone does not grant access or link
an external identity automatically.

```bash
latex-render-admin users create \
  --email admin@example.com \
  --display-name "Example Admin" \
  --role admin \
  --authentication password --login-name example-admin --password-stdin
```

Supply the password through standard input, never as a command argument or in
logs. For external authentication, use `--authentication external --subject`
with the provider's subject instead. Only an owner can create another owner;
the server enforces duplicate identities, login names and account restrictions.
See [Admin CLI authentication](docs/admin-cli-authentication.md) for both modes.

Standalone installations do not require Cloudflare credentials. When Access is
enabled, its policy must also permit the identity: application registration
does not change that policy. Remote CLI calls through Access require both
`CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` in addition to the Admin key.

Existing legacy Access linkage details remain available for recovery. Linking,
unlinking, password reset and external identity changes must use the explicit
owner-authorized operations shown by the current authentication configuration.
Changing an application identity does not edit the external provider's policy
or terminate its independent session.

User creation and authentication changes are audited. Keep passwords, JWTs,
OTPs and API secrets out of audit reasons and comments.

API secrets are shown once. Never paste them into prompts, project files, logs, or issue comments.

## Recover an API key whose secret was never received

If issuance succeeded and the one-time secret never reached the recipient,
revoke the issued key and create a new one for the same service account with
the intended scopes. Capture the new secret when it appears and deliver it
through a secure channel.

In the Admin CLI, look up the issued key ID, service account, and scopes. The
example reissues a rendering key. Substitute your IDs, name, and scopes.

```bash
latex-render-admin api-keys list --query render-client
latex-render-admin api-keys get KEY_ID
latex-render-admin api-keys revoke KEY_ID --yes
latex-render-admin api-keys create --service-account SERVICE_ACCOUNT_ID \
  --name render-client --scope render:create render:read:own
```

In the Web UI, open **API keys** in `/admin/` and identify the issued key by
name and prefix. Open **Details** to verify the key ID, service account, and
scopes. Click **Revoke** on that row and confirm with **Revoke**. Then choose
**Issue API key**, select the service account, key type, and intended scopes,
enter a name, and click **Issue**. Use **Copy and close** to capture the secret.

## Backups

Owners can use `backup status`, `backup create`, and `backup verify` in
`latex-render-admin`. Use `backup retention` to view local retention or preview
proposed limits. `backup retention set` confirms the limits and prunes local
archives immediately. See the preview and confirmation commands in the
[backup and restore guide](BACKUP_RESTORE.md#local-retention).
