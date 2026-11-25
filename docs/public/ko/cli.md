---
slug: cli
category: CLI
title: CLI로 변환하고 결과 받기
description: 터미널에서 TeX를 컴파일하고 PDF, 로그 및 미리 보기를 받습니다.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

`main.tex`가 있는 폴더에서 `n624-latex main.tex`을 실행하면 같은 폴더에 PDF가 저장됩니다. 처음이라면 [CLI 설치](/ko/docs/client/)에 따라 연결을 설정하세요.

## 인증 {#認証}

일반적으로 브라우저에서 설정 화면을 열어 API 키를 저장합니다.

```sh
n624-latex setup --gui
```

SSH 접속 등 브라우저를 열 수 없는 환경에서는 키가 명령줄 인수에 남지 않도록 **표준 입력**으로 등록합니다. 아래 Bash/Zsh 예제에서는 첫 줄을 실행한 뒤 키를 붙여 넣고 Enter를 누른 다음 나머지 줄을 실행합니다.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

Windows에서는 [설치 프로그램의 숨김 입력](/ko/docs/windows/#インストール)으로도 등록할 수 있습니다.

다음 명령으로 저장 상태를 확인하거나 키를 삭제합니다.

```sh
n624-latex auth status
n624-latex auth logout
```

- 환경 변수 `LATEX_RENDER_API_KEY`가 설정되어 있으면 로컬에 저장한 키보다 우선합니다.
- `logout`은 로컬에 저장된 키만 지웁니다. 환경 변수를 해제하거나 서버의 키를 폐기하는 작업은 별도로 수행합니다.

### 대상 서버 {#接続先サーバー}

기본적으로 호스팅 서비스(`https://latex-render.n624.jp`)에 연결합니다. 자체 호스팅 환경은 명령을 실행할 셸에서 서버의 HTTPS URL을 설정하세요.

- URL 끝에 `/app/` 또는 `/api/v1/`를 붙이지 마세요.
- 해당 서버가 발급한 API 키를 사용하세요.

**Linux 및 macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## 설정 및 진단 {#セットアップと診断}

연결 및 연동 설정은 `n624-latex setup`으로 엽니다. 접속이 안 되면 먼저 다음 명령으로 상태를 확인합니다. `n624-latex`를 찾을 수 없으면 [설치 및 PATH 확인](/ko/docs/troubleshooting/#インストール-ログイン)을 참고하세요.

```sh
n624-latex setup status
n624-latex doctor
```

`doctor`는 설치와 자격 증명을 읽기 전용으로 점검하며 API 키 값을 출력하지 않습니다. 문제가 발견되면 종료 코드 `2`를 반환합니다.

| 설치 방식 | 업데이트와 복구 |
| --- | --- |
| APT | [APT로 업데이트](/ko/docs/client/#apt-版の更新)하고 손상된 패키지는 [다시 설치](/ko/docs/client/#状態確認と修復)합니다. Local MCP는 [수동 등록](/ko/docs/mcp/#local-mcpの登録)합니다. |
| Homebrew | [Homebrew로 업데이트](/ko/docs/client/#homebrew-版の更新)하고 손상된 패키지는 [다시 설치](/ko/docs/client/#状態確認と修復)합니다. AI 연동은 `n624-latex setup`에서 설정합니다. |
| 배포 설치 프로그램 | [설정 화면에서 업데이트](/ko/docs/client/#配布インストーラー版の更新)합니다. 관리 대상 연동과 실행기는 `n624-latex setup repair`로 복구합니다. |

제거할 때는 [설치 방식별 절차](/ko/docs/client/#アンインストール)를 따르세요. 설정 화면은 로컬 기기에서만 열리며 CLI를 종료하면 함께 닫힙니다.

## 렌더링 {#レンダリング}

### TeX 파일 직접 변환 {#tex-ファイルを直接変換する}

프로젝트 폴더 내의 `.tex` 파일을 지정해 PDF를 만듭니다. 이미지, 참고문헌, 로컬 `.sty` 등은 폴더 내 상대 경로로 참조할 수 있습니다.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- `-o`를 생략하면 실행한 폴더에 입력 파일과 이름이 같은 PDF(예: `main.pdf`)를 생성합니다.
- LaTeX 오류가 발생하면 식별 가능한 파일명, 줄 번호, 작업 ID가 표시됩니다. 변환이나 다운로드에 실패해도 이전에 정상 저장된 PDF는 유지합니다.

#### LaTeX 엔진 선택 {#latex-のエンジンを選ぶ}

XeLaTeX를 사용하려면 파일명 앞에 엔진 이름을 씁니다.

```sh
n624-latex xelatex main.tex
```

엔진을 생략하면 문서 시작 부분의 `% !TeX program = xelatex` 또는
`% !TEX TS-program = xelatex` 지시문을 확인합니다. 문서에 지시문이 없으면
프로젝트 루트의 `.n624-latex.json`을 확인합니다. 이를
Git에 공유하면 다른 기기에서도 같은 엔진을 선택합니다.

```json
{"engine":"xelatex"}
```

별도 지정이 없으면 LuaLaTeX를 사용합니다. pLaTeX와 upLaTeX는 서버의
런타임에 일본어 컬렉션이 있을 때 사용할 수 있습니다.

| 엔진 | 문서 이전 시 점검 사항 |
| --- | --- |
| LuaLaTeX | `fontspec`나 LuaTeX-ja를 사용하는 문서의 설정을 확인합니다. |
| pdfLaTeX | `fontspec`를 사용할 수 없습니다. pdfLaTeX용 글꼴 설정을 사용합니다. |
| XeLaTeX | `fontspec`를 지원합니다. LuaTeX 전용 패키지가 있는지 확인합니다. |
| pLaTeX / upLaTeX | 엔진에 맞는 일본어 문서 클래스를 사용합니다. upLaTeX에서 `jsarticle`을 사용할 때는 클래스 옵션 `uplatex`을 지정합니다. |

참고문헌 처리는 문서의 패키지와 설정을 따릅니다. `.bib`와 사용자 정의 `.bst`도 함께 업로드하세요. pLaTeX와 upLaTeX로 BibTeX 문서를 처리할 때는 각각 pBibTeX와 upBibTeX를 사용합니다. 서버의 [렌더링 환경](/app/environment/)에서 PDF, SVG, SVG 배치 검증 여부를 확인할 수 있습니다.

### ZIP 또는 여러 출력 지정 {#zip-複数の出力を指定する}

로그, 미리 보기, SVG 등 결과 전체를 받거나 ZIP을 지정하려면 `render` 하위 명령을 사용합니다.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**실행 예**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- 경로를 생략하면 현재 폴더, `--entrypoint`를 생략하면 `main.tex`를 사용합니다. 최대 500개 파일의 입력 소스를 준비하고 완료까지 기다립니다. 상대 `.tex` 경로를 지정할 수 있으며 서버도 파일 존재 여부와 경로 안전성을 확인합니다.
- `--svg`를 추가하면 PDF와 함께 가장 바깥쪽 수식과 최상위 TikZ 그림을 각각 독립된 SVG로 추출합니다.

### 같은 소스로 여러 문서 만들기 {#同じ入力から複数の文書を作る-source-の再利用}

한 폴더나 ZIP의 여러 본문을 변환할 때는 `source upload`로 한 번만 올리고 반환된 소스 ID를 재사용하세요. 각 작업에는 별도의 출력 경로(`--output`)를 지정합니다.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] 출력 정리, 제외 및 중복 업로드 생략
>
> - **이전 출력 정리.** 같은 경로를 재사용하면 이전 `job.json`에 기록된 PDF, 미리 보기, SVG 중 이번 결과에 없는 파일만 정리합니다. 무관한 사용자 파일은 보존합니다.
> - **대상 경로 검증.** 심볼릭 링크가 있는 출력 경로는 거부합니다. POSIX에서는 소유권과 그룹·기타 사용자의 쓰기 권한도 확인합니다. Windows에는 POSIX 모드 비트 검사를 적용하지 않습니다.
> - **출력 자동 제외.** `--output`로 프로젝트의 하위 폴더를 지정하면 다음 입력 ZIP에서 그 폴더만 제외합니다. 이름이 비슷한 다른 폴더는 포함하며 프로젝트 루트 자체는 출력 경로로 지정할 수 없습니다.
> - **중복 전송 생략.** 동일 소유자의 유효한 ZIP과 SHA-256이 같으면 `uploadRequired: false`를 반환하고 재전송을 생략합니다. 반환된 소스 ID는 같은 소유자의 후속 작업에만 사용할 수 있습니다.

## 저장된 프로젝트와 버전 {#保存projectと改訂}

CLI에서 저장된 프로젝트와 버전을 관리하고 다시 변환할 수 있습니다. 같은 사용자의 웹, API, MCP 및 다른 API 키에서도 공유합니다. 임시 `render`이나 `source upload`에는 저장 프로젝트가 필요하지 않습니다.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`**는 로컬 폴더나 ZIP을 소스로 준비해 지정한 프로젝트에 변경 불가능한 버전으로 저장합니다. `--svg`를 추가하면 처음 출력이 PDF와 SVG로 설정됩니다.
- **`render`**는 저장된 버전에서 작업을 생성합니다. `--svg`를 지정한 경우에만 저장된 출력 설정을 재정의합니다.
- **`list`, `get`, `jobs`**는 `--cursor`로 다음 페이지를 가져올 수 있습니다.
- **`delete`**는 목록에서 프로젝트를 숨깁니다. 기존 작업이 즉시 완전히 삭제되지는 않습니다.

## 작업 관리 {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **다운로드와 대기.** 작업 명령은 API 키로 단기 토큰을 갱신합니다. `jobs download`는 완료까지 기다렸다가 결과 파일을 교체합니다. 대기 중 중단되거나 실패하면 기존 파일을 보존합니다. `delete`는 종료된 작업에만 적용됩니다.
- **PNG 추가 다운로드.** 처음에는 1페이지만 생성합니다. 일반 다운로드는 이미 생성된 PNG만 받습니다. `--preview-page 2 5`처럼 지정하면 해당 페이지를 생성하고 크기와 SHA-256을 검증한 뒤 저장합니다. PDF를 다시 컴파일하거나 보관 기한을 늘리지 않습니다.
- **PDF 먼저 받기 및 SVG 재시도.** PDF와 SVG를 요청한 경우 `--pdf-only`로 SVG 완료 전 PDF를 받습니다. SVG만 실패하면 PDF가 유지되고 부분 성공으로 표시됩니다. `retry-svg`는 확정된 PDF를 유지하고 SVG만 다시 시도합니다. 최초 시도를 포함해 최대 8회이며 보관 기한은 늘어나지 않습니다. 런타임이 변경됐다면 새 작업을 만드세요. [PDF 조기 제공과 SVG 재시도](/ko/docs/api/#pdfの先行公開とsvgの再試行)를 참고하세요.
- **통신 오류 재시도.** 상태 확인 중 일시적 통신 장애는 자동 재시도합니다. 인증·권한 오류는 즉시 반환합니다. CLI가 대기를 중단해도 서버에서 처리가 계속될 수 있으므로 새로 만들기 전에 같은 `<jobId>`를 조회하세요. [CLI 대기 및 재시도](/ko/docs/reference/#cliの待機と再試行)를 참고하세요.

## 결과 파일 {#成果物}

PDF를 먼저 받거나 특정 페이지의 PNG를 받고 SVG 추출을 재시도하는 절차는 [PDF, PNG, SVG 받기](/ko/docs/outputs/)를 참고하세요.

| 경로 | 내용 |
| --- | --- |
| `.render/result.pdf` | 성공한 컴파일의 PDF |
| `.render/compile.log` | LaTeX 컴파일 로그 |
| `.render/errors.json` | 구조화된 오류 정보 |
| `.render/job.json` | 최종 작업 상태 |
| `.render/previews/page-N.png` | 페이지 미리 보기 이미지(최대 100페이지) |
| `.render/svg/manifest.json` | SVG와 소스 위치·PDF 좌표의 대응 관계 |
| `.render/svg/objects/*.svg` | 수식 또는 TikZ 그림별 독립 SVG |

## JSON 출력 {#json出力}

모든 CLI 명령에 `--json`을 추가하면 진행 메시지 없이 표준 출력에 JSON 객체 하나만 씁니다. 일반 표시와 같은 `client-core` 결과를 사용하며 API 키와 단기 토큰은 제외합니다.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

성공·실패 시의 스키마와 종료 코드는 [CLI JSON 형식](/ko/docs/reference/#cliのjson形式)을 참고하세요.
