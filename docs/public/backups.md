---
slug: backups
category: セルフホスト
title: バックアップを作成・検証・復旧する
description: 定期バックアップと更新時の復旧点の違い、確認方法、データ復旧の流れです。
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## 何が保存されるか

| 種類 | 含まれるもの | 主な用途 |
| --- | --- | --- |
| **定期バックアップ** | SQLite データベースと、有効な保存プロジェクト改訂が参照する入力 ZIP | 日常の DB・保存プロジェクトの保全 |
| **更新時の復旧点** | 更新直前の SQLite、アプリのストレージ全体、更新前のバージョン情報 | アプリ更新失敗時の調査と更新前状態への復旧 |
| **ホスト設定の別バックアップ** | `/etc/latex-renderer/` 等の構成ファイル、秘密鍵、TLS 証明書、Akebi 状態等 | サーバー故障時のホスト再構築 |

- 定期バックアップには、一時ジョブの成果物（PDF 等）やプロジェクト未保存の入力 ZIP は含まれません。
- ホスト設定や証明書、バックアップ復号鍵（age identity）は別途保全し、**暗号化バックアップ本体と復号鍵は同じ障害で同時に失われないよう別の安全な場所に保管してください。**

## 手動で作成する

管理画面が対応している版では、所有者（Owner）でログインして **管理 → システム → バックアップ** を開き、**作成** を押します。完了後に **最新を検証** を実行し、検証時刻とファイル名が更新されることを確認します（検証にはサーバー上の復号鍵が必要です）。

### コマンドで作成・検証する

1. サーバー上で暗号化バックアップを即時作成します（保存先は `/etc/latex-renderer/backup.env` の `BACKUP_DIRECTORY`、既定値は `/var/lib/latex-renderer/backups`。自動実行は `latex-renderer-backup.timer` が担います）。

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. 作成された `.tar.age` アーカイブを特定し、GNU `tar` と `age` が使える安全な検証用 Linux 環境で復元テストを実行します。

```bash
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/restore-test.mjs /path/to/backup.tar.age
```

このテストは一時領域にのみ展開して SQLite の整合性・外部キー制約と入力 ZIP のサイズ・SHA-256 を検証するため、稼働中の DB やストレージには一切書き込みません（外部ストレージへコピーしたバックアップも同様に検証してください）。

## 更新失敗後の復旧点を確認する

アプリ更新の失敗後に `RECOVERY_REVIEW_REQUIRED` が表示された場合は、管理者権限で復旧点の状態を確認します。

```sh
sudo n624-latex server recovery status
```

（旧版・手動配置環境では `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status` を実行します）。

1. 表示された復旧点 ID（`POINT_ID`）、アプリと Updater の版、DB スキーマ、稼働中サービスを照合します。データ復旧が必要な場合は、先にアーカイブと現在の設定を別領域へ保全してください。
2. 調査を終え、「データ復元は不要であり、この復旧点の保護を解除してよい」と判断した場合にのみ `acknowledge` を実行します。

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

※ `acknowledge` は復旧レビュー状態を終了して条件に応じサービスを再開させる操作であり、**データの巻き戻しは行いません**。保護解除された復旧点は通常の自動整理対象に戻ります。

## データを復旧する場合

バックアップ時点以降の変更は失われます。DB 互換がありアプリだけを前の版へ戻せば済む場合は、[更新画面のロールバック](/docs/updates/#前の版へ戻す)を使ってください。データを巻き戻す場合は、まず検証用ホストで手順を試してから実施します。

1. **対象特定と現状保全**：戻したいバックアップと、その DB スキーマに対応するアプリのバージョンを特定します。本番作業前に現在の DB・ストレージ・設定も別途退避します。
2. **サービスの停止**：更新や定期クリーンアップと競合しないよう、共有の管理ロック下で DB・ストレージに書き込む全サービスとタイマーを停止します。
3. **展開と整合性検証**：空の非公開作業ディレクトリにアーカイブを復号・展開し、整合性を検証します（更新時の復旧点を使う場合は、root 管理の `summary.json` と内部マニフェストも照合します）。
4. **同時点への配置**：SQLite と入力・成果物ストレージを必ず**同じ復旧時点**に揃えて配置します（定期バックアップからの復旧では、復旧済み DB が示す検証済みの `storage_key` に入力 ZIP を配置します）。対応するバージョンのアプリ、設定ファイル、所有者・パーミッションも揃えます。
5. **起動と確認**：サービスを起動し、ログイン、保存プロジェクトの再変換、成果物取得、バックアップの再実行を確認します。監査ログの出力位置不一致でエクスポートが止まった場合は[監査ログの復旧](/docs/reference/#監査ログの復旧)を実施します。

詳細資料：[運用時のバックアップ形式と検査条件（OPERATIONS.md）](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) · [更新時の復旧点の設計](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md)
