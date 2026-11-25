---
slug: updates
category: Self-hosting
title: Update or roll back the server
description: Apply a stable release, verify the update, and choose a recovery or rollback procedure if it fails.
navOrder: 68
updated: "2026-11-22"
since: "v1.3.6"
---

## Before updating {#更新する前に}

| What you want to change | Where to change it |
| --- | --- |
| Server application | **Administration → Updates** |
| TeX Live version or languages | **Administration → TeX environment**. See [Configure the TeX environment](/en/docs/self-hosting/#tex環境の初期設定). |
| Local `n624-latex` APT package | [Update the APT package](/en/docs/client/#apt-版の更新) |

Check these three things before starting.

1. [Create and verify an encrypted backup](/en/docs/backups/#手動で作成する).
2. Choose a time when few users have active conversion jobs.
3. Leave maintenance mode at `normal`. The updater stops and starts the necessary services and runs a test conversion.

## Apply a stable release {#正式版を適用する}

1. Sign in as an owner and open **Administration → Updates** (`/admin/updates/`).
2. Leave the version field empty and choose **Check for updates** to see the current version and available stable release.
3. Choose **Download, verify, and update**, enter the reason for the change, and choose **Start update**.
4. Record the **Operation ID** and check that the operation completes successfully.
   - If the app has updated and the updater switchover is pending, check the results for the same operation and open the updater details.
   - Closing the browser does not stop the update. If a service restart briefly returns `502`, wait for the interface to reconnect automatically.
5. Sign in from another browser or a private window. Compile a representative document, download the PDF, and check both the application and updater versions.

## Notifications and automatic updates {#通知と自動更新}

Under **Update policy**, choose between checking and notifying only (the default) and automatically applying verified updates.

- Automatic updates apply only to stable releases.
- To test a release candidate in a dedicated test environment, enter its published tag explicitly in the form `vX.Y.Z-rc.N`.

## If an update fails {#更新が失敗した場合}

Open the detailed log and check the operation ID and failed stage. Check the current application and updater versions, whether sign-in and conversion work, and whether a recovery review is required. The displayed version number alone cannot establish the outcome.

- **`UPDATE_MAINTENANCE_ACTIVE`.** Check for ongoing maintenance work. Return maintenance mode to `normal` before starting the update.
- **`RECOVERY_REVIEW_REQUIRED`.** Follow [Review a recovery point after an unsuccessful update](/en/docs/backups/#更新失敗後の復旧点を確認する).

## Roll back to the previous version {#前の版へ戻す}

- **Application-only rollback is available.** In **Administration → Updates**, check the rollback target and choose **Roll back to previous version** if available. Afterward, test sign-in and PDF conversion.
- **The database change is incompatible.** Restore the database and storage together from the matching recovery point. Follow [Restore data](/en/docs/backups/#データを復旧する場合).

See [Migration and special recovery procedures](/en/docs/reference/#旧版からの移行と特殊復旧) and the [updater specification and retention policy](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md).
