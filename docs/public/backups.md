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

1. 所有者（Owner）でログインし、**管理 → システム → バックアップ** を開きます。
2. **バックアップを作成** を押し、作成が完了するまで待ちます。
3. **最新のバックアップを検証** を押し、**最終検証** に対象のファイル名と検証時刻が表示されることを確認します。検証にはサーバー上の復号鍵が必要です。

### コマンドで作成・検証する

1. サーバー上で暗号化バックアップを即時作成します（保存先は `/etc/latex-renderer/backup.env` の `BACKUP_DIRECTORY`、既定値は `/var/lib/latex-renderer/backups`。自動実行は `latex-renderer-backup.timer` が担います）。

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. 作成した `.tar.age` アーカイブを検証用の Linux ホストにコピーします。GNU `tar`、`age`、`node:sqlite` を使える対応 Node.js（24 または 26）、復号鍵を準備します。長期保管時はアーカイブと復号鍵を別々に保管します。
3. バックアップを作成したアプリの版に対応するサーバー配布物を、[手動でダウンロードして検証する手順](/docs/self-hosting/#v1-6-9をダウンロードして検証)で取得・展開します。先頭の `version=` にその版を指定します。展開先を `release_dir` に設定し、配布物のスクリプトを実行します。

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

`restore_test.completed` が表示されれば検証は完了です。テストは一時領域に展開した SQLite と入力 ZIP の整合性を検証します。外部ストレージへ移したバックアップも、その保管先から取り出して検証できます。

## 更新失敗後の復旧点を確認する

アプリ更新の失敗後に `RECOVERY_REVIEW_REQUIRED` が表示された場合は、管理者権限で復旧点の状態を確認します。

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　旧版で状態を確認する
>
> `n624-latex server recovery status` がない環境では、`sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status` を実行します。

1. 表示された復旧点 ID（`POINT_ID`）、アプリと Updater の版、DB スキーマ、稼働中サービスを照合します。データ復旧が必要な場合は、先にアーカイブと現在の設定を別領域へ保全してください。
2. 調査を終え、「データ復元は不要であり、この復旧点の保護を解除してよい」と判断した場合にのみ `acknowledge` を実行します。

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` は復旧レビューを終了し、条件に応じてサービスを再開します。データを戻す場合は、復旧点を保護した状態で次の手順へ進みます。

## データを復旧する場合

バックアップ時点以降の変更は失われます。DB 互換がありアプリだけを前の版へ戻せば済む場合は、[更新画面のロールバック](/docs/updates/#前の版へ戻す)を使ってください。データを巻き戻す場合は、まず検証用ホストで手順を試してから実施します。

1. **対象特定と現状保全**：戻したいバックアップと、その DB スキーマに対応するアプリのバージョンを特定します。本番作業前に現在の DB・ストレージ・設定も別途退避します。
2. **サービスの停止**：更新や定期クリーンアップと競合しないよう、共有の管理ロック下で DB・ストレージに書き込む全サービスとタイマーを停止します。
3. **展開と整合性検証**：空の非公開作業ディレクトリにアーカイブを復号・展開し、整合性を検証します（更新時の復旧点を使う場合は、root 管理の `summary.json` と内部マニフェストも照合します）。
4. **同時点への配置**：SQLite と入力・成果物ストレージを必ず**同じ復旧時点**に揃えて配置します（定期バックアップからの復旧では、復旧済み DB が示す検証済みの `storage_key` に入力 ZIP を配置します）。対応するバージョンのアプリ、設定ファイル、所有者・パーミッションも揃えます。
5. **起動と確認**：サービスを起動し、ログイン、保存プロジェクトの再変換、成果物取得、バックアップの再実行を確認します。監査ログの出力位置不一致でエクスポートが止まった場合は[監査ログの復旧](/docs/reference/#監査ログの復旧)を実施します。

詳細資料：[運用時のバックアップ形式と検査条件（OPERATIONS.md）](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) · [更新時の復旧点の設計](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md)
