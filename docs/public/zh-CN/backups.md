---
slug: backups
category: 自托管
title: 创建、验证和恢复备份
description: 了解定期备份与更新恢复点的区别，验证备份并恢复数据。
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## 备份包含哪些内容 {#何が保存されるか}

| 类型 | 内容 | 主要用途 |
| --- | --- | --- |
| **定期备份** | SQLite 数据库以及有效版本、草稿和处理中的预览所引用的输入 ZIP | 日常保护数据库、已保存的项目和正在编辑的文档 |
| **更新恢复点** | 更新前的 SQLite、全部应用存储和原版本信息 | 调查更新失败原因并恢复更新前的状态 |
| **主机配置的单独备份** | `/etc/latex-renderer/` 等配置文件、私钥、TLS 证书和 Akebi 状态等 | 主机故障后重建服务器 |

- 从定期备份恢复后，请在编辑器中打开项目重新生成预览。临时作业的输出文件和工作缓存不在定期备份范围内。
- 请单独备份主机配置、证书和备份解密密钥（age identity）。**加密备份与解密密钥应分别存放在不同的安全位置，以免同一故障造成两者同时丢失。**

## 手动创建备份 {#手動で作成する}

1. 以所有者身份登录，打开**管理 → 系统 → 备份**。
2. 点击**创建备份**并等待完成。
3. 点击**验证最新备份**，确认**上次验证**显示目标文件名和验证时间。验证时服务器上必须有解密密钥。

### 通过命令行创建并验证 {#コマンドで作成-検証する}

1. 在服务器上立即创建加密备份。保存位置由 `/etc/latex-renderer/backup.env` 中的 `BACKUP_DIRECTORY` 指定，默认为 `/var/lib/latex-renderer/backups`；定期备份由 `latex-renderer-backup.timer` 执行。

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. 将生成的 `.tar.age` 归档复制到用于验证的 Linux 主机。准备 GNU `tar`、`age`、支持 `node:sqlite` 的 Node.js（24 或 26）及解密密钥。长期保存时，请将归档和解密密钥分开存放。
3. 按[手动下载和验证步骤](/zh-CN/docs/self-hosting/#v1-6-9をダウンロードして検証)取得与创建备份的应用版本相符的服务器发行包并解压。先将命令开头的 `version=` 设为该版本，再把 `release_dir` 设为解压目录，并运行发行包中的脚本。

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

显示 `restore_test.completed` 即表示验证完成。测试会在临时目录解压并校验 SQLite 与输入 ZIP 的一致性。已转移到外部存储的备份也可从保存位置取回验证。

## 更新失败后检查恢复点 {#更新失敗後の復旧点を確認する}

如果应用更新失败后显示 `RECOVERY_REVIEW_REQUIRED`，请使用管理员权限检查恢复点状态。

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　在旧版本上查看状态
>
> 如果没有 `n624-latex server recovery status` 命令，请运行 `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`。

1. 核对恢复点 ID（`POINT_ID`）、应用和更新程序版本、数据库模式以及正在运行的服务。如需恢复数据，请先将归档和当前配置保存在其他位置。
2. 调查完成后，仅当确认无需恢复数据且可以解除该恢复点的保护时，才执行 `acknowledge`。

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge` 会结束恢复审查，并在条件允许时恢复服务。如需回滚数据，请保留恢复点保护并按下文操作。

## 恢复数据 {#データを復旧する場合}

备份时间点之后的更改会丢失。如果数据库兼容且只需退回应用版本，请使用[更新页面的回滚功能](/zh-CN/docs/updates/#前の版へ戻す)。如需回滚数据，请先在测试主机演练。

1. **确定目标并保存现状。** 找出目标备份，并确定与其数据库模式兼容的应用版本。操作生产环境前，单独保存现有数据库、存储和配置。
2. **停止服务。** 在共享管理锁保护下，停止所有写入数据库或存储的服务和定时器，以免与更新或定期清理冲突。
3. **解压并验证。** 将归档解密、解压至空的私有工作目录，验证完整性。使用更新恢复点时还要将 root 管理的 `summary.json` 与内部清单核对。
4. **恢复至相同时间点。** SQLite 与输入和输出存储必须来自**同一恢复点**。从定期备份恢复时，将输入 ZIP 放在已恢复数据库记录且已验证的 `storage_key` 位置。应用版本、配置文件、所有者和权限也应匹配。
5. **启动并验证。** 启动服务，验证登录、已保存项目的重新转换、输出下载和再次执行备份。如果审计日志因输出位置不一致停止导出，请参见[恢复审计日志](/zh-CN/docs/reference/#監査ログの復旧)。

参见[运行环境的备份格式和验证条件](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries)及[更新恢复点设计](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md)。
