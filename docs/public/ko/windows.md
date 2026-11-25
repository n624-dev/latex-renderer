---
slug: windows
category: 설치
title: Windows에 CLI 설치하기
description: PowerShell에서 CLI를 설치하고 API 키를 등록하여 PDF를 만듭니다.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## 설치 {#インストール}

1. **Node.js 24 이상**과 서버 관리자에게 받은 API 키(`lrk_...`)를 준비합니다.
2. 평소 사용하는 계정으로 PowerShell을 열고 다음 명령을 실행합니다.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. 입력 내용이 표시되지 않는 필드에 API 키를 붙여 넣습니다. Windows는 현재 사용자만 사용할 수 있도록 키를 암호화해 저장합니다.
4. 설치가 끝나면 **새 PowerShell 창**을 엽니다. [자체 호스팅 서버를 사용하는 경우](/ko/docs/cli/#接続先サーバー) 변환 전에 서버 주소를 지정합니다.

나중에 키를 다시 등록하려면 `n624-latex setup`으로 설정 화면을 엽니다.

## 첫 변환 {#最初の変換}

1. 파일 탐색기에서 `main.tex`가 있는 폴더를 엽니다. [예제 문서](/ko/docs/#最短でpdfを作る)를 사용해도 됩니다.
2. 파일 탐색기 주소 표시줄에 `powershell`을 입력하고 Enter를 누릅니다. 열린 PowerShell에서 다음 명령을 실행합니다.

```powershell
n624-latex main.tex
```

같은 폴더에 `main.pdf`가 생성됩니다. ZIP이나 여러 결과 파일을 다루려면 [CLI 변환 방법](/ko/docs/cli/#レンダリング)을 참고하세요.

## 업데이트 {#更新}

PowerShell에서 `n624-latex setup`을 실행한 뒤 설정 화면에서 업데이트합니다.

> [!DETAILS] 履歴資料　v1.6.9 이하에서 이전하기
>
> [설치 단계](#インストール)에서 사용한 설치 프로그램을 `-SkipCredential` 옵션과 함께 실행합니다. 저장된 API 키를 유지하면서 `n624-latex`를 추가합니다. 설치 위치를 변경했었다면 [같은 위치를 지정](/ko/docs/reference/#windowsの配置と保護)하세요. 기존 스크립트에서는 계속 `latex-render`를 사용할 수 있습니다.

## API 키만 삭제하기 {#apiキーだけを削除}

클라이언트를 유지하고 저장된 API 키만 삭제하려면 다음 명령을 실행합니다.

```powershell
n624-latex auth logout
```

## 제거 {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

기본적으로 클라이언트, 저장된 API 키 및 설치 프로그램이 관리하는 Codex·Claude 스킬이 삭제됩니다. 키나 스킬을 유지하려면 각각 `-KeepCredential` 또는 `-KeepSkills`를 명령 끝에 추가하세요.
