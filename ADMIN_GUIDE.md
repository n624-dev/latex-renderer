# Administrator guide

`/admin/` is exclusively for human users with the database role `owner` or `admin`.

- `owner`: role changes, owner lifecycle, admin-key issuance/rotation, ticket-key revocation, and all normal operations.
- `admin`: daily user, client, render-key, job, worker, maintenance, and audit operations, subject to protected owner-only actions.
- `user`: never uses `/admin/`; uses CLI/MCP and `/api/v1/` through a service account.

The Web UI covers dashboard/client registration, users, service accounts, API keys, jobs, worker control, maintenance, and audit logs. Admin CLI remains available for automation and advanced remote operations. Admin Local remains for break-glass recovery when network or Access authentication is unavailable.

## Administrator invitations

Register a user by email, display name, and role. Do not collect or enter an Access Subject:

```bash
latex-render-admin users create \
  --email admin@example.com \
  --display-name "Example Admin" \
  --role admin
```

This creates an active, unlinked database record. On the user's first browser login, the Admin API matches the verified Access JWT email and links its `sub` claim exactly once. Repeating the same claim is safe; a different identity receives a conflict instead of replacing the existing link. Only an owner can create another owner, and an existing email cannot be registered again even when its user is disabled.

The database invitation does not grant access through Cloudflare Access. Add the identity or its group to the Access Allow policy separately; both the Access policy and the VPS-side invitation/role must authorize the user.

The users page shows `初回ログイン待ち` until the verified Access identity is linked, then shows `連携済み` and the linkage time. The Access user ID is available only in user details. An owner can require a fresh claim with `Access連携を解除`; a reason and explicit confirmation are mandatory. Unlinking increments the linkage generation and application security version, but does not edit the Cloudflare Access policy or revoke an existing Access session. If unlinking your own identity, the Web UI signs out immediately to avoid reclaiming in the same page load.

Invitation, successful/failed claim, and unlink events are written to `audit_logs`. Claim failure metadata contains only an application error code. JWT bodies, OTPs, API tokens, and the previous Access user ID are not written to audit metadata. Never include a secret in an unlink reason.

API secrets are shown once. Never paste them into prompts, project files, logs, or issue comments.
