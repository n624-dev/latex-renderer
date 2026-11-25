---
slug: index
category: 시작하기
title: LaTeX Renderer 사용 안내
description: 브라우저, 터미널 또는 AI 도구에서 LaTeX 문서를 PDF로 변환합니다.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## 첫 PDF 만들기 {#最短でpdfを作る}

1. [웹 앱](/app/)을 열고 관리자가 안내한 방법으로 로그인합니다.
2. `.tex` 파일을 선택하고 **PDF로 변환**을 누릅니다. 이미지나 참고문헌이 있다면 문서와 함께 ZIP으로 묶어서 선택합니다.
3. 결과 화면에서 PDF를 엽니다. 나중에 다시 보려면 웹 앱의 **기록**을 엽니다.

시험할 문서가 없다면 아래 내용을 UTF-8로 인코딩하여 `main.tex` 파일로 저장합니다.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [일본어 예제와 ZIP 구성 방법](/ko/docs/projects/)
- [웹 앱 사용 안내](/ko/docs/web/)
- [PDF와 PNG 저장 및 SVG 재시도](/ko/docs/outputs/)

터미널에서는 먼저 [운영체제에 맞는 CLI를 설치](/ko/docs/client/)합니다. `n624-latex setup`으로 연결을 설정한 뒤 `main.tex` 파일이 있는 폴더에서 `n624-latex main.tex`을 실행하면 `main.pdf`가 생성됩니다.

## 사용 방법 선택 {#利用方法を選ぶ}

| 하려는 작업 | 사용할 기능 | 안내 |
| --- | --- | --- |
| **브라우저에서 간편하게 변환** | 웹 앱 | [브라우저에서 변환하기](/ko/docs/web/) |
| **터미널에서 변환하여 로컬에 저장** | Windows·macOS·Linux용 CLI | [CLI 설치](/ko/docs/client/) |
| **ChatGPT 또는 Claude에서 변환** | Remote MCP 및 OAuth 로그인 | [ChatGPT 또는 Claude 연결](/ko/docs/mcp/) |
| **Codex 또는 Claude Code에서 로컬 문서 작업** | CLI, Local MCP, 스킬 | [Codex와 Claude Code에서 사용](/ko/docs/integrations/) |
| **자체 앱에서 변환 자동화** | HTTP API | [공개 API](/ko/docs/api/) |
| **자체 Linux 서버에서 운영** | 자체 호스팅 | [서버 운영 안내](/ko/docs/self-hosting/) |

## 준비물 {#必要なもの}

- **웹 앱과 Remote MCP**에는 서버 관리자가 안내한 로그인 계정이 필요합니다.
- **CLI, Local MCP, HTTP API**에는 관리자가 발급한 렌더링 API 키(`lrk_`로 시작)가 필요합니다.
- **CLI 실행 환경**은 설치 방식에 따라 다릅니다.
  - Debian 및 Ubuntu용 APT 패키지에는 전용 Node.js가 포함되어 있습니다.
  - macOS용 Homebrew 패키지는 필요한 Node.js를 함께 설치합니다.
  - Windows, macOS, Linux용 배포 설치 프로그램에는 Node.js 24 이상이 필요합니다.

모든 변환은 서버에서 처리하므로 어떤 방식을 사용하든 로컬 기기에 TeX Live를 설치할 필요가 없습니다.

> [!WARNING]
> API 키를 AI 대화, 소스 코드, Git 저장소 또는 로그에 붙여 넣지 마세요. 유출이 의심되면 즉시 관리자에게 키 폐기와 재발급을 요청하세요.

변환이나 로그인에 문제가 있으면 [문제 해결 안내](/ko/docs/troubleshooting/)를 확인하세요.
