---
slug: windows
category: 安装
title: 在 Windows 上安装 CLI
description: 使用 PowerShell 安装 CLI、注册 API 密钥并生成 PDF。
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## 安装 {#インストール}

1. 准备 **Node.js 24 或更高版本**及服务器管理员提供的 API 密钥（`lrk_...`）。
2. 使用日常账号打开 PowerShell，运行以下命令。

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. 将密钥粘贴到不回显的输入框中。密钥将加密保存，仅供当前 Windows 用户使用。
4. 安装完成后，打开**新的 PowerShell 窗口**。如果[使用自托管服务器](/zh-CN/docs/cli/#接続先サーバー)，请在转换前指定服务器地址。

如需重新注册密钥，运行 `n624-latex setup` 打开设置页面。

## 首次转换 {#最初の変換}

1. 在文件资源管理器中打开 `main.tex` 所在的目录。也可使用[示例文档](/zh-CN/docs/#最短でpdfを作る)。
2. 在文件资源管理器的地址栏中输入 `powershell` 并按 Enter。在打开的 PowerShell 中运行以下命令。

```powershell
n624-latex main.tex
```

同一目录中会生成 `main.pdf`。要处理 ZIP 或获取多种输出，请参见 [CLI 转换指南](/zh-CN/docs/cli/#レンダリング)。

## 更新 {#更新}

在 PowerShell 中运行 `n624-latex setup`，然后在设置页面执行更新。

> [!DETAILS] 履歴資料　从 v1.6.9 或更早版本迁移
>
> 按[安装步骤](#インストール)运行相同的安装程序，并加上 `-SkipCredential`。这会保留已保存的 API 密钥并添加 `n624-latex`。如果之前更改过安装目录，请[指定相同的位置](/zh-CN/docs/reference/#windowsの配置と保護)。现有脚本仍可使用 `latex-render`。

## 仅删除 API 密钥 {#apiキーだけを削除}

若要保留客户端并删除保存的密钥，请运行以下命令。

```powershell
n624-latex auth logout
```

## 卸载 {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

默认情况下会删除客户端、已保存的 API 密钥及受管理的 Codex 和 Claude 技能。如需保留密钥或技能，请在命令末尾分别添加 `-KeepCredential` 或 `-KeepSkills`。
