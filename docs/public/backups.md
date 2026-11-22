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

| 種類                       | 含まれるもの                                                    | 使う場面                                                 |
| -------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| 定期バックアップ           | SQLite と、保存中のプロジェクト改訂が参照する入力 ZIP           | データベースと保存プロジェクトの保全                     |
| 更新時の復旧点             | 更新直前の SQLite、アプリのストレージ全体、更新前の版の情報     | アプリ更新の失敗を調査し、必要に応じて更新前の状態へ復旧 |
| ホスト設定の別バックアップ | 構成ファイル、資格情報、TLS、外部サービス設定、必要な追加データ | ホストの故障・再構築                                     |

定期バックアップには一時的なジョブの成果物やすべての入力 ZIP は含まれません。ホストを再構築するための設定、証明書、Akebi の状態、復号鍵は、必要に応じて別途保全します。復号鍵と暗号化データは、同じ故障でまとめて失わない場所に分けて保管してください。

## 手動で作成する

対応版では、所有者でログインし、**管理 → システム → バックアップ**で **作成** を選びます。作成が完了したら **最新を検証** を選び、状態を更新して検証時刻とファイル名を確認します。検証にはサーバーの復号鍵が必要です。

### コマンドで作成・検証する

初期セットアップ済みのサーバーで、暗号化バックアップを今すぐ作成します。保存先は `/etc/latex-renderer/backup.env` の `BACKUP_DIRECTORY`、既定は `/var/lib/latex-renderer/backups` です。定期実行は `latex-renderer-backup.timer` が管理します。

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

成功した回のアーカイブを特定し、Linux の GNU tar と age が使える、復号鍵を持ち出しても安全な検証用環境で次を実行します。

```bash
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/restore-test.mjs /path/to/backup.tar.age
```

復元テストは一時領域に復号し、SQLite の整合性と外部キー、対応する入力 ZIP のサイズと SHA-256 を確認します。稼働中の SQLite やストレージには書き込みません。暗号化バックアップを別の場所へコピーした場合は、そのコピーも検証してください。

## 更新失敗後の復旧点を確認する

更新失敗後に `RECOVERY_REVIEW_REQUIRED` と表示された場合は、サーバーの管理者権限で状態を確認します。

```text
sudo n624-latex server recovery status
```

旧版では次を使用します。

```bash
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status
```

表示された復旧点 ID、アプリと Updater の版、スキーマ、起動中のサービスを照合します。復旧が必要なら、先にアーカイブと設定を保全します。復旧点の保護を解除する操作は、確認を終えてその復旧点が不要と判断したときにだけ実行します。

```bash
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

この操作は復旧レビューを終了し、条件に応じてサービスを戻します。データは復元されず、保護解除した復旧点は通常の整理対象になります。

## データを復旧する場合

バックアップ時刻以降の変更を失う可能性があります。まず検証用ホストで復旧を試します。通常のアプリ更新でアプリだけを前の版へ戻せる状況なら、[更新画面のロールバック](/docs/updates/#前の版へ戻す)を使います。

1. 対象のバックアップと対応するアプリの版を特定します。本番で作業する前に、現在の状態も別に保全します。
2. 同じ更新や定期処理と競合しないように、共有の管理ロック下で DB・ストレージへ書き込むサービスやタイマーを停止します。
3. アーカイブを空の非公開作業領域に展開し、復号結果の整合性を検証します。更新時の復旧点では、root 管理の `summary.json` と内部のマニフェストも照合します。
4. SQLite と入力・成果物は同じ復旧時点にそろえます。定期バックアップの入力は復旧済み DB が示す検証済みの `storage_key` に配置します。対応するアプリ、設定、所有者とアクセス権も復旧します。
5. サービスを起動し、ログイン、プロジェクトの再変換、取得できる成果物、バックアップの再実行を確認します。監査ログの出力位置に不一致があれば[監査ログの復旧](/docs/reference/#監査ログの復旧)に従います。

[運用時のバックアップ形式と検査条件](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries) · [更新時の復旧点の設計](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md)
