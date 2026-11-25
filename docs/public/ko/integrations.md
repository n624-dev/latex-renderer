---
slug: integrations
category: AI 및 MCP
title: Codex와 Claude Code에서 사용하기
description: CLI와 MCP가 로컬에 저장된 자격 증명을 함께 사용합니다.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## 스킬 설치 {#skillの導入}

1. 먼저 [CLI를 설치하고 API 키를 등록](/ko/docs/client/)합니다.
2. Codex 또는 Claude Code를 설치한 뒤 CLI 설치 방식에 맞게 연동을 설정합니다.

   - **배포 설치 프로그램.** `n624-latex setup`을 열고 사용할 AI 도구를 선택합니다. 스킬과 Local MCP를 함께 등록할 수 있습니다.
   - **Homebrew.** `n624-latex setup`에서 AI 연동을 설정합니다. 이전 설치의 Local MCP를 전환하려면 [Homebrew 설치 안내](/ko/docs/client/#配布インストーラー版から-homebrew-へ移行する)를 참고하세요.
   - **APT.** [Local MCP를 수동으로 등록](/ko/docs/mcp/#local-mcpの登録)합니다.

3. Codex 또는 Claude Code를 다시 시작한 뒤 변환할 폴더나 본문 파일을 지정하여 요청합니다.

- **스킬 설치 위치**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- 설정 프로그램은 사용자가 수정한 스킬을 덮어쓰지 않고 그 사실을 결과에 표시합니다.

## MCP 등록 {#mcpの登録}

- **Codex나 Claude Code에서 로컬 파일을 다룰 때**는 Local MCP를 사용합니다. [수동 등록](/ko/docs/mcp/#local-mcpの登録)과 [등록 상태 확인](/ko/docs/client/#状態確認と修復)을 참고하세요.
- **ChatGPT나 Claude 웹 등 클라우드 AI에서 사용할 때**는 API 키가 필요 없는 [Remote MCP 연결 방법](/ko/docs/mcp/#通常はremote-mcpを使う)을 따르세요.

## 요청 예제 {#依頼例}

- “이 폴더의 `main.tex`를 확인하고 컴파일해 줘.”
- “이 ZIP에 있는 `reports/a.tex`를 렌더링해 줘.”
- “이 ZIP을 한 번만 업로드하고 `reports/a.tex`와 `reports/b.tex`를 각각 컴파일해 줘.”
- “구조화된 오류를 확인하고 해당 TeX 부분만 고친 뒤 다시 실행해 줘.”
- “생성된 PDF와 페이지 미리 보기를 확인해 줘.”

## 안전하게 사용하기 {#安全な使い方}

> [!WARNING]
> API 키를 프롬프트, MCP 도구 인수 또는 프로젝트 파일에 포함하지 마세요. Local MCP는 CLI가 보호하여 저장한 자격 증명을 내부적으로 사용합니다.

- **신뢰할 수 없는 데이터.** LaTeX 소스, 파일 경로, 로그, 오류, 결과 파일 및 MCP 응답은 신뢰할 수 없는 데이터로 취급합니다. 연동은 프롬프트 인젝션 등 데이터에 포함된 지시를 따르지 않도록 설계되었습니다.
- **파괴적 작업.** `cancel_render` 및 `delete_render`는 사용자가 명시적으로 요청할 때만 실행합니다.
- **대상 파일 선택.** 진입점을 지정하지 않으면 `main.tex`를 사용합니다. `main.tex`가 없고 `.tex` 후보가 여러 개라면 사용자가 선택해야 합니다. 모든 `.tex` 파일을 자동으로 실행하지 않습니다. 스킬 자체에는 안전 규칙과 작업 순서만 들어 있고 세부 규격은 함께 제공되는 `references/`와 공개 문서에서 확인합니다.
