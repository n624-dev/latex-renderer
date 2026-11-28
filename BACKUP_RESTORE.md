# Backup and restore

Target RPO is 24 hours and target RTO is 4 hours for the MVP. `latex-renderer-backup.timer` creates a WAL-consistent SQLite snapshot, manifest, and encrypted archive. Render source/artifact trees are excluded by default because normal retention must remain enforceable. Audit export is independently encrypted and uploaded to append-only/off-host storage.

## Local retention

The timer runs daily at 02:15 server time with up to 20 minutes of randomized
delay. Local retention starts when an owner confirms the limits. It runs
immediately after confirmation and after every successful backup. It enforces
the age, generation count, and total byte limits on `BACKUP_DIRECTORY`. The
newest local archive and the latest restore-verified archive are always kept.
The plan warns if the protected archives alone exceed a limit. Uploaded copies
follow their own retention policy.

Run `n624-latex admin backup retention` to see the current policy, the daily
schedule, archive sizes and available space, suggested limits, and the last
pruning result. If there are no completed archives, run `n624-latex admin backup
create` and wait for it to finish. The suggested byte limit is
`floor((free bytes on the backup filesystem + existing archive bytes - MIN_FREE_STORAGE_BYTES) / 4)`,
with a minimum of zero. Divide that budget by the size of the latest backup and
round down to get the suggested days and generations, each between 1 and 30.

Preview the exact limits you plan to confirm. Review `proposedPlan.delete` and
`proposedPlan.warnings` before setting them. For example, to keep up to seven
days, seven generations and 10 GiB, run these commands in order.

```sh
n624-latex admin backup retention \
  --max-age-days 7 --max-generations 7 --max-total-bytes 10737418240
n624-latex admin backup retention set \
  --max-age-days 7 --max-generations 7 --max-total-bytes 10737418240 \
  --reason 'Local backup disk budget' --yes
```

For API clients, use `GET /admin/api/v1/backups/retention` with the three limit
query parameters to preview, then `POST` to the same endpoint with those limits
and a reason. Confirmation is recorded as `backup.retention.confirmed`. If
immediate pruning fails, the response shows `prune.status: failed` and the policy
stays saved for subsequent runs. The CLI prints the result and exits with status

1. The server stores the last run beside the verification receipt at
   `/var/lib/latex-renderer-backup-verification/retention.json`.

## Off-host copies and recovery

Keep 14 daily and 3 monthly encrypted generations off-host. Alert if no successful backup or audit export appears within 30 hours. Encryption recipients/keys and upload credentials are systemd credentials, never repository files.

Quarterly, restore into a new temporary directory, decrypt, verify archive hashes and SQLite `PRAGMA integrity_check`, then start an isolated read-only Admin API against the restored DB. Record duration and row counts. Never overwrite the live DB during a test. A real restore requires stopped services, preserved failed media, atomic placement of the restored DB, correct ownership, migration verification, and health checks before the worker resumes.
