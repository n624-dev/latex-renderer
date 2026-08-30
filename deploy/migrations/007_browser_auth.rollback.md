# Migration 007 rollback

Migration 007 is intentionally forward-only. It permits nullable and duplicate
user email attributes and creates external identities, local password
credentials, and revocable browser sessions. Releases before v1.2.0 cannot
interpret those records safely.

Do not perform an application-only rollback after this migration is applied.
Restore the verified pre-v1.2.0 encrypted database backup together with the
previous application release, then run `PRAGMA integrity_check` and
`PRAGMA foreign_key_check` before reopening ingress.
