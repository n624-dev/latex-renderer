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
