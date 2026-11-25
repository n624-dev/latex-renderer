---
slug: client
category: 安装
title: 安装 CLI
description: 在 Windows、macOS 或 Linux 上安装 CLI，并在终端中生成第一份 PDF。
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## 支持的平台 {#対応環境}

按操作系统选择安装方式，并注册服务器管理员提供的 API 密钥（`lrk_...`）。LaTeX 文档由服务器编译。

| 平台 | 安装方式 | Node.js 要求 |
| --- | --- | --- |
| Debian 12 / 13、Ubuntu 24.04 / 26.04（amd64 或 arm64） | **[APT 软件包](#debian-ubuntu-の-apt-パッケージ)** | 随软件包提供 |
| Windows | **[Windows 安装指南](/zh-CN/docs/windows/)** | 24 或更高版本 |
| macOS（Apple 芯片或 Intel） | **[Homebrew](#homebrew-でインストール)** | 由 Homebrew 安装 |
| macOS 或其他 Linux 发行版 | **[独立安装程序](#linux-macos)** | 24 或更高版本 |

## 在 Debian 或 Ubuntu 上使用 APT 安装 {#debian-ubuntu-の-apt-パッケージ}

1. [下载 `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources)。该文件包含用于验证 LaTeX Renderer APT 软件包签名的公钥。
2. 在保存文件的目录中运行以下命令安装软件包。

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. 接下来[生成第一份 PDF](#最初の-pdf-を作る)。如需搭建服务器，请参见[自托管安装指南](/zh-CN/docs/self-hosting/)。

## 使用 Homebrew 安装 {#homebrew-でインストール}

在已安装 Homebrew 的 Mac 上运行以下命令。

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

注册 API 密钥后，即可[生成第一份 PDF](#最初の-pdf-を作る)。

### 从独立安装版迁移到 Homebrew {#配布インストーラー版から-homebrew-へ移行する}

安装后仍可使用已保存的 API 密钥和 MCP 配置。运行 `type -a n624-latex` 查看 shell 首先找到的命令。如果旧版排在前面，可运行以下命令直接启动 Homebrew 版。

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

若要让 `n624-latex` 默认使用 Homebrew 版，请在 shell 的 `PATH` 中将 Homebrew 的 `bin` 放在旧安装目录之前。

如需同时切换 Local MCP，请在 AI 工具的现有配置中，将 `latex-renderer` 的命令改为 Homebrew 下 `bin/latex-renderer-mcp` 的绝对路径。可运行 `brew --prefix` 查看 Homebrew 的安装位置。

卸载旧版前，请重启 AI 工具并确认能连接到 Homebrew 版 Local MCP。用旧启动程序的绝对路径执行卸载，并保留 API 密钥和技能。旧版安装在默认目录时可用以下命令。

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## 使用独立安装程序前的准备 {#配布インストーラーの準備}

请为日常使用的账号安装 **Node.js 24 或更高版本**。可用 `node --version` 查看版本。Windows 用户请参见 [Windows 安装指南](/zh-CN/docs/windows/)。

## Linux 和 macOS {#linux-macos}

在终端中将安装程序下载到临时目录，然后用 Node.js 运行。

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

如果找不到 `n624-latex`，请打开新终端。如果问题仍然存在，请运行 `export PATH="$HOME/.local/bin:$PATH"`，并将同一行加入当前 shell 的配置文件，例如 `~/.bashrc` 或 `~/.zshrc`。

## 生成第一份 PDF {#最初の-pdf-を作る}

1. 使用日常账号打开设置页面，保存 API 密钥。连接自托管服务时，请先[指定服务器](/zh-CN/docs/cli/#接続先サーバー)。没有浏览器时，可以[通过标准输入注册密钥](/zh-CN/docs/cli/#認証)。

```sh
n624-latex setup
```

2. 在 `main.tex` 所在目录运行以下命令。也可以使用[示例文档](/zh-CN/docs/#最短でpdfを作る)。

```sh
n624-latex main.tex
```

同一目录中会生成 `main.pdf`。如需指定输出路径或处理 ZIP、PDF 和 SVG，参见[通过 CLI 转换文档并获取结果](/zh-CN/docs/cli/#レンダリング)。

## Windows {#windows}

[Windows 安装指南](/zh-CN/docs/windows/)使用 PowerShell。Windows DPAPI 会加密密钥，并将其绑定到当前 Windows 用户。参见[更改安装目录和修复 PATH](/zh-CN/docs/reference/#windowsの配置と保護)。

## 更新 {#更新}

### 更新 APT 版 {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

更新会保留连接配置和 API 密钥。如需更新自托管服务器本身，请使用[管理页面的更新功能](/zh-CN/docs/updates/)。

### 更新 Homebrew 版 {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### 更新独立安装版 {#配布インストーラー版の更新}

运行以下命令，或重新执行首次安装时的安装命令。

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　更新 v1.6.9 及更早版本的客户端
>
> 如果只安装了 `latex-render`，请重新执行安装步骤。[Windows 更新无需重新输入已保存的密钥](/zh-CN/docs/windows/#更新)。macOS 和 Linux 用户也可先运行 `latex-render setup` 更新，然后运行 `latex-render setup repair` 添加新命令。现有脚本仍可使用 `latex-render`。

> [!DETAILS] 设置和更新的工作方式
>
> - 如果下载的 ZIP 与已安装版本的 SHA-256 相同，安装程序只检查受管理配置，无需重新部署文件。
> - 更新时，安装程序会将旧版本移入带时间戳的备份目录。其他启动程序、其他 MCP 注册项和用户修改过的技能会保留。

## 检查和修复安装 {#状態確認と修復}

无论选择哪种安装方式，均可使用以下命令检查状态。

```sh
n624-latex setup status
n624-latex doctor --json
```

- APT 版可用 `sudo apt install --reinstall n624-latex` 重新安装软件包。
- Homebrew 版可用 `brew reinstall n624-dev/tap/n624-latex` 重新安装软件包。
- 独立安装版可用 `n624-latex setup repair` 修复受管理的启动程序和集成配置。

## 保存与恢复输出文件 {#成果物の保存と復旧}

`n624-latex main.tex` 生成的 PDF 保存在当前目录。关于 `render` 和 `jobs download` 保存的 PDF、日志和图片，参见 [CLI 输出文件](/zh-CN/docs/cli/#成果物)。如果目标目录被占用，参见[故障排查指南](/zh-CN/docs/troubleshooting/#成果物の取得)。

## 卸载 {#アンインストール}

APT 版可用 `sudo apt remove n624-latex` 卸载。如需同时删除用户的 API 密钥，请在卸载前运行 `n624-latex auth logout`。

Homebrew 版可用 `brew uninstall n624-dev/tap/n624-latex` 卸载。已保存的 API 密钥和 AI 工具的 MCP 配置会保留。如不再需要，请在卸载前退出登录，并在 AI 工具中删除 MCP 配置。

独立安装版可用以下命令卸载。

```sh
n624-latex setup remove --yes
```

若需保留凭据或技能，请分别指定 `--keep-credential` 或 `--keep-skills`。使用 Windows 脚本卸载时，请参见 [Windows 安装指南](/zh-CN/docs/windows/#アンインストール)。
