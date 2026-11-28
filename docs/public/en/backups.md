---
slug: backups
category: Self-hosting
title: Create, verify, and restore backups
description: Compare scheduled backups with update recovery points, verify an archive, and restore data.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## What each backup contains {#何が保存されるか}

| Type | Contents | Main use |
| --- | --- | --- |
| **Scheduled backup** | SQLite database and input ZIPs referenced by active revisions, drafts, and previews in progress | Protect the database, saved projects, and documents being edited |
| **Update recovery point** | Pre-update SQLite database, all application storage, and pre-update version information | Investigate failed updates and restore the pre-update state |
| **Separate host configuration backup** | Configuration such as `/etc/latex-renderer/`, private keys, TLS certificates, and Akebi state | Rebuild the host after server failure |

- After restoring a scheduled backup, open each project in the editor to regenerate its preview. Scheduled backups exclude temporary job artifacts and working caches.
- Back up host settings, certificates, and the backup decryption key (age identity) separately. **Keep encrypted backups and their decryption keys in separate, secure locations so a single failure cannot destroy both.**

## Create a backup manually {#手動で作成する}

1. Sign in as an owner and open **Administration → System → Backups**.
2. Choose **Create backup** and wait for completion.
3. Choose **Verify latest backup**. Under **Last verification**, check the file name and verification time. Verification requires the decryption key on the server.

### Create and verify a backup from the command line {#コマンドで作成-検証する}

Configure an owner's admin API key on your client, then request the backup.

```sh
n624-latex admin backup create
n624-latex admin backup status
```

When creation finishes, run `n624-latex admin backup verify`. Use `n624-latex admin backup status` to check the file name and time in `latestVerification`. The server saves the backup in `BACKUP_DIRECTORY`, which defaults to `/var/lib/latex-renderer/backups`. On older clients that lack the `backup` command, use the administration page above.

Use `n624-latex admin backup retention` to see the daily schedule, suggested limits, and current local retention plan. Supply `--max-age-days`, `--max-generations`, and `--max-total-bytes` together to preview the deletion list and warnings. After reviewing the preview, use `backup retention set` with the same limits, `--reason`, and `--yes` to save them and prune immediately. Successful backups apply those limits going forward. The newest archive and the latest restore-verified archive are protected. Uploaded copies follow their own retention policy.

### Verify on a separate host

1. Copy the resulting `.tar.age` archive to a Linux verification host. Prepare GNU `tar`, `age`, a supported Node.js version (24 or 26) with `node:sqlite`, and the decryption key. For long-term storage, keep the archive and key separately.
2. [Download, verify, and extract the server distribution](/en/docs/self-hosting/#v1-6-9をダウンロードして検証) for the application version that created the backup. Set the initial `version=` to that version. Set `release_dir` to the extracted directory and run the script from the distribution.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

Verification is complete when you see `restore_test.completed`. The test extracts the SQLite database and input ZIPs to temporary storage and checks their consistency. For recent backups, `application.version` and `application.commit` identify the release that created the backup. For older backups with `application: null`, check your records for the release in use when the backup was made. To verify an off-site backup, retrieve it from storage and run the same test.

## Review a recovery point after an unsuccessful update {#更新失敗後の復旧点を確認する}

If `RECOVERY_REVIEW_REQUIRED` appears after an application update fails, use administrative privileges to check the recovery point.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　Check status on older versions
>
> If `n624-latex server recovery status` is unavailable, run `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`.

1. Compare the recovery point ID (`POINT_ID`), application and updater versions, database schema, and running services. If data recovery is needed, first copy the archive and current configuration to separate storage.
2. Run `acknowledge` only after investigating and determining that data restoration is unnecessary and protection can be removed from this recovery point.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` ends the recovery review and resumes services when conditions allow. If you need to restore data, keep the recovery point protected and follow the steps below.

## Restore data {#データを復旧する場合}

Changes made since the backup will be lost. If the database is compatible and only the application needs to revert, use [rollback in the Updates screen](/en/docs/updates/#前の版へ戻す). Before restoring data in production, rehearse the procedure on a test host.

1. **Identify the target and preserve current data.** Identify the backup and the application version compatible with its database schema. Make separate copies of the current database, storage, and configuration before working on production.
2. **Stop services.** Under the shared management lock, stop every service and timer that writes to the database or storage to avoid conflicts with updates and scheduled cleanup.
3. **Extract and verify.** Decrypt and extract the archive in an empty private working directory and verify its integrity. For an update recovery point, also compare the root-managed `summary.json` with the internal manifest.
4. **Restore one consistent point in time.** Restore SQLite and input/artifact storage from **the same recovery point**. For a scheduled backup, place each input ZIP at the verified `storage_key` specified by the restored database. Match the application version, configuration files, ownership, and permissions.
5. **Start services and verify.** Test sign-in, recompilation of a saved project, artifact downloads, and a new backup. If audit export stops because the output position differs, follow [Recover audit logs](/en/docs/reference/#監査ログの復旧).

See [Operational backup format and verification requirements](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) and the [update recovery point design](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
