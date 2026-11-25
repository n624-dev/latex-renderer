---
slug: client
category: Installation
title: Install the CLI
description: Install the CLI on Windows, macOS, or Linux and compile your first PDF from a terminal.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Supported platforms {#対応環境}

Install the CLI for your operating system and register the API key (`lrk_...`) from your server administrator. The server compiles your LaTeX documents.

| Platform | Installation method | Node.js requirement |
| --- | --- | --- |
| Debian 12 / 13 or Ubuntu 24.04 / 26.04 (amd64 or arm64) | **[APT package](#debian-ubuntu-の-apt-パッケージ)** | Included |
| Windows | **[Windows instructions](/en/docs/windows/)** | 24 or later |
| macOS (Apple Silicon or Intel) | **[Homebrew](#homebrew-でインストール)** | Installed by Homebrew |
| macOS or other Linux distributions | **[Downloadable installer](#linux-macos)** | 24 or later |

## Install the APT package on Debian or Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. Download [`n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). The file includes the public key for verifying LaTeX Renderer APT signatures.
2. In the folder where you saved the file, run these commands.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Continue to [Make your first PDF](#最初の-pdf-を作る). To set up a server, see the [self-hosting instructions](/en/docs/self-hosting/).

## Install with Homebrew {#homebrew-でインストール}

On a Mac with Homebrew installed, run these commands.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

After registering your API key, continue to [Make your first PDF](#最初の-pdf-を作る).

### Switch from the downloadable installer to Homebrew {#配布インストーラー版から-homebrew-へ移行する}

You can keep your saved API key and existing MCP settings. Run `type -a n624-latex` to see which command your shell finds first. If the previous installation comes first, start the Homebrew version directly.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

To make `n624-latex` use the Homebrew version, put Homebrew’s `bin` directory before the old installation in your shell’s `PATH`.

To switch Local MCP as well, edit the existing `latex-renderer` entry in your AI tool and set its command to the absolute path of Homebrew’s `bin/latex-renderer-mcp`. Run `brew --prefix` to find the Homebrew installation.

Before removing the previous installation, restart the AI tool and check that it connects to the Homebrew Local MCP server. Use the absolute path to the old launcher and keep the API key and skills. For an old installation in the default location, run this command.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Prepare to use the downloadable installer {#配布インストーラーの準備}

Install **Node.js 24 or later** for your usual user account. Check your version with `node --version`. On Windows, follow the [Windows instructions](/en/docs/windows/).

## Linux and macOS {#linux-macos}

Download the installer to a temporary folder in a terminal and run it with Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

If your shell cannot find `n624-latex`, open a new terminal. If the problem persists, run `export PATH="$HOME/.local/bin:$PATH"` and add the same line to your shell configuration, such as `~/.bashrc` or `~/.zshrc`.

## Make your first PDF {#最初の-pdf-を作る}

1. Using your usual account, open setup and save your API key. For a self-hosted installation, [specify the server](/en/docs/cli/#接続先サーバー) first. If you cannot open a browser, [register the key through standard input](/en/docs/cli/#認証).

```sh
n624-latex setup
```

2. Run this command in the folder containing `main.tex`. You can use the [sample document](/en/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

The CLI writes `main.pdf` to the same folder. See [Compile and download results with the CLI](/en/docs/cli/#レンダリング) to choose an output folder or work with ZIP, PDF, and SVG files.

## Windows {#windows}

The [Windows instructions](/en/docs/windows/) use PowerShell. Windows DPAPI encrypts the saved key for the current Windows user. See [Windows installation paths and credential protection](/en/docs/reference/#windowsの配置と保護) to change the installation path or repair `PATH`.

## Updates {#更新}

### Update the APT package {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

The update preserves your connection settings and API key. To update a self-hosted server, use the [administration interface](/en/docs/updates/).

### Update the Homebrew package {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Update a client installed with the downloadable installer {#配布インストーラー版の更新}

Run the following command or repeat the original installation command.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Update clients running v1.6.9 or earlier
>
> If only `latex-render` is installed, repeat the installation instructions. [Windows can update without asking for your saved key again](/en/docs/windows/#更新). On macOS and Linux, you can also update with `latex-render setup` and then add the new command with `latex-render setup repair`. Existing scripts can continue to use `latex-render`.

> [!DETAILS] How setup and updates work
>
> - If the downloadable ZIP has the same SHA-256 as the installed version, setup checks managed settings without reinstalling files.
> - During an update the installer moves the previous version to a timestamped backup. It preserves other launchers, other MCP registrations, and user-modified skills.

## Check and repair an installation {#状態確認と修復}

Check the status of any installation with these commands.

```sh
n624-latex setup status
n624-latex doctor --json
```

- For APT, reinstall with `sudo apt install --reinstall n624-latex`.
- For Homebrew, reinstall with `brew reinstall n624-dev/tap/n624-latex`.
- For a downloadable installation, run `n624-latex setup repair` to repair managed launchers and integration settings.

## Save and recover output files {#成果物の保存と復旧}

`n624-latex main.tex` saves the PDF in the current folder. See [CLI output files](/en/docs/cli/#成果物) for PDFs, logs, and images saved by `render` and `jobs download`. If the destination is in use, see [Troubleshooting](/en/docs/troubleshooting/#成果物の取得).

## Uninstall {#アンインストール}

For APT, run `sudo apt remove n624-latex`. To remove the user’s stored API key as well, run `n624-latex auth logout` before uninstalling.

For Homebrew, run `brew uninstall n624-dev/tap/n624-latex`. The saved API key and your AI tool’s MCP settings remain. If you no longer need them, log out before uninstalling and remove the MCP settings in the AI tool.

For the downloadable installer, run this command.

```sh
n624-latex setup remove --yes
```

To keep credentials or skills from a downloadable installation, use `--keep-credential` or `--keep-skills`, respectively. To remove the client with the Windows script, see the [Windows instructions](/en/docs/windows/#アンインストール).
