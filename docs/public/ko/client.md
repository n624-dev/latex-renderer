---
slug: client
category: 설치
title: CLI 설치하기
description: Windows, macOS, Linux에 CLI를 설치하고 터미널에서 첫 PDF를 만듭니다.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## 지원 환경 {#対応環境}

운영체제에 맞는 방법으로 설치한 뒤 서버 관리자에게 받은 API 키(`lrk_...`)를 등록합니다. LaTeX 컴파일은 서버에서 수행합니다.

| 플랫폼 | 설치 방법 | Node.js 요구 사항 |
| --- | --- | --- |
| Debian 12 / 13, Ubuntu 24.04 / 26.04(amd64, arm64) | **[APT 패키지](#debian-ubuntu-の-apt-パッケージ)** | 패키지에 포함 |
| Windows | **[Windows 설치 안내](/ko/docs/windows/)** | 24 이상 |
| macOS(Apple Silicon, Intel) | **[Homebrew](#homebrew-でインストール)** | Homebrew가 설치 |
| macOS 및 기타 Linux | **[배포 설치 프로그램](#linux-macos)** | 24 이상 |

## Debian 또는 Ubuntu에서 APT로 설치 {#debian-ubuntu-の-apt-パッケージ}

1. [`n624-latex.sources` 다운로드](https://apt.n624.jp/latex-renderer/n624-latex.sources). 이 파일에는 LaTeX Renderer APT 서명 검증용 공개 키가 들어 있습니다.
2. 파일을 저장한 폴더에서 아래 명령으로 패키지를 설치합니다.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. [첫 PDF 만들기](#最初の-pdf-を作る)로 이동합니다. 서버를 구축하려면 [자체 호스팅 설치 안내](/ko/docs/self-hosting/)를 따르세요.

## Homebrew로 설치 {#homebrew-でインストール}

Homebrew가 설치된 Mac에서 다음을 실행합니다.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

API 키를 등록한 뒤 [첫 PDF 만들기](#最初の-pdf-を作る)로 이동합니다.

### 배포 설치 프로그램에서 Homebrew로 이전 {#配布インストーラー版から-homebrew-へ移行する}

설치 후에도 저장된 API 키와 기존 MCP 설정을 사용할 수 있습니다. `type -a n624-latex`로 셸이 어떤 명령을 먼저 찾는지 확인하세요. 이전 버전이 먼저 나오면 다음 명령으로 Homebrew 버전을 직접 실행합니다.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

평소 실행하는 `n624-latex`도 Homebrew 버전을 사용하려면 셸의 `PATH`에서 Homebrew의 `bin`이 기존 설치 경로보다 먼저 오도록 합니다.

Local MCP도 바꾸려면 AI 도구의 기존 설정에서 `latex-renderer` 명령을 Homebrew의 `bin/latex-renderer-mcp` 절대 경로로 변경합니다. Homebrew 경로는 `brew --prefix`로 확인합니다.

이전 버전을 제거하기 전에 AI 도구를 재시작하고 Homebrew 버전의 Local MCP에 연결되는지 확인합니다. 이전 실행기의 절대 경로를 사용해 API 키와 스킬을 보존하며 제거합니다. 기본 위치에 설치했다면 다음 명령을 사용하세요.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## 배포 설치 프로그램 준비 {#配布インストーラーの準備}

평소 사용하는 계정에 **Node.js 24 이상**을 준비합니다. 버전은 `node --version`으로 확인할 수 있습니다. Windows에서는 [Windows 설치 안내](/ko/docs/windows/)를 따르세요.

## Linux 및 macOS {#linux-macos}

터미널에서 설치 프로그램을 임시 폴더에 내려받은 뒤 Node.js로 실행합니다.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

`n624-latex`를 찾을 수 없으면 새 터미널을 엽니다. 계속 찾지 못하면 `export PATH="$HOME/.local/bin:$PATH"`를 실행하고, 사용하는 셸 설정 파일(예: `~/.bashrc` 또는 `~/.zshrc`)에도 같은 줄을 추가합니다.

## 첫 PDF 만들기 {#最初の-pdf-を作る}

1. 평소 사용하는 계정으로 설정 화면을 열고 API 키를 저장합니다. 자체 호스팅 환경은 먼저 [대상 서버를 지정](/ko/docs/cli/#接続先サーバー)합니다. 브라우저가 없는 환경에서는 [표준 입력으로 키를 등록](/ko/docs/cli/#認証)할 수 있습니다.

```sh
n624-latex setup
```

2. `main.tex`가 있는 폴더에서 다음을 실행합니다. [예제 문서](/ko/docs/#最短でpdfを作る)를 사용해도 됩니다.

```sh
n624-latex main.tex
```

같은 폴더에 `main.pdf`가 생성됩니다. 출력 경로를 지정하거나 ZIP, PDF 및 SVG를 다루려면 [CLI로 변환하고 결과 받기](/ko/docs/cli/#レンダリング)를 참고하세요.

## Windows {#windows}

[Windows 설치 안내](/ko/docs/windows/)에서는 PowerShell을 사용합니다. 등록한 API 키는 Windows DPAPI로 현재 사용자에게 묶어 암호화합니다. [설치 경로 변경 및 PATH 복구](/ko/docs/reference/#windowsの配置と保護)도 참고하세요.

## 업데이트 {#更新}

### APT 패키지 업데이트 {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

저장된 연결 설정과 API 키는 유지됩니다. 자체 호스팅 서버 자체를 업데이트하려면 [관리 화면의 업데이트 기능](/ko/docs/updates/)을 사용하세요.

### Homebrew 패키지 업데이트 {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### 배포 설치 프로그램으로 설치한 버전 업데이트 {#配布インストーラー版の更新}

다음 명령을 실행하거나 처음 사용한 설치 명령을 다시 실행합니다.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　v1.6.9 이전 버전 및 v1.6.9 클라이언트 업데이트
>
> `latex-render`만 설치된 환경은 설치 절차를 다시 실행합니다. [Windows에서는 저장한 키를 다시 입력할 필요가 없습니다](/ko/docs/windows/#更新). macOS 또는 Linux에서는 `latex-render setup`으로 업데이트하고 `latex-render setup repair`로 새 명령을 추가할 수도 있습니다. 기존 스크립트에서는 계속 `latex-render`를 사용할 수 있습니다.

> [!DETAILS] 설치와 업데이트의 동작 방식
>
> - 배포 ZIP의 SHA-256이 설치된 버전과 같으면 파일은 재배치하지 않고 관리 대상 설정만 확인합니다.
> - 업데이트 시 이전 버전을 날짜와 시간이 붙은 백업으로 이동합니다. 다른 실행기, 다른 MCP 등록 및 사용자가 수정한 스킬은 보존합니다.

## 상태 확인과 복구 {#状態確認と修復}

설치 방식에 관계없이 다음 명령으로 상태를 확인할 수 있습니다.

```sh
n624-latex setup status
n624-latex doctor --json
```

- APT 버전은 `sudo apt install --reinstall n624-latex`로 패키지를 다시 설치합니다.
- Homebrew 버전은 `brew reinstall n624-dev/tap/n624-latex`로 패키지를 다시 설치합니다.
- 배포 설치 프로그램 버전은 `n624-latex setup repair`로 관리 대상 실행기와 연동 설정을 복구합니다.

## 결과 파일 저장과 복구 {#成果物の保存と復旧}

`n624-latex main.tex`로 만든 PDF는 현재 폴더에 저장됩니다. `render` 또는 `jobs download`로 저장하는 PDF, 로그, 이미지에 관해서는 [CLI 결과 파일](/ko/docs/cli/#成果物)을 참고하세요. 대상 경로가 사용 중이면 [문제 해결 안내](/ko/docs/troubleshooting/#成果物の取得)를 확인하세요.

## 제거 {#アンインストール}

APT 버전은 `sudo apt remove n624-latex`로 제거합니다. 사용자의 API 키도 삭제하려면 제거 전에 `n624-latex auth logout`을 실행하세요.

Homebrew 버전은 `brew uninstall n624-dev/tap/n624-latex`로 제거합니다. 저장된 API 키와 AI 도구의 MCP 설정은 남습니다. 필요 없다면 제거 전에 로그아웃하고 AI 도구에서도 MCP 설정을 삭제하세요.

배포 설치 프로그램 버전은 다음 명령으로 제거합니다.

```sh
n624-latex setup remove --yes
```

자격 증명이나 스킬을 보존하려면 각각 `--keep-credential` 또는 `--keep-skills`를 지정합니다. Windows 스크립트로 제거하려면 [Windows 설치 안내](/ko/docs/windows/#アンインストール)를 참고하세요.
