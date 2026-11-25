---
slug: outputs
category: 웹 및 CLI
title: PDF, PNG, SVG 받기
description: PDF와 페이지 이미지를 저장하고 수식 및 TikZ 그림을 SVG로 추출하거나 다시 시도합니다.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## PDF 열기와 저장 {#pdf-を開く-保存する}

- **웹 앱.** [기록](/app/history/)에서 문서를 선택한 뒤 결과 화면의 파일 목록에서 `result.pdf`를 엽니다. PDF와 SVG를 함께 요청해도 PDF는 완성되는 즉시 받을 수 있습니다.
- **CLI.** 표시된 `<jobId>`를 지정하여 내려받습니다. `--pdf-only`를 추가하면 SVG가 끝나기 전에 PDF를 받을 수 있습니다. 다른 문서의 파일을 덮어쓰지 않도록 필요에 따라 별도의 `--output` 폴더를 지정하세요.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## 페이지 이미지 받기 {#ページ画像を取得する}

페이지 전체를 이미지로 저장하려면 PNG 미리 보기를 사용합니다. 처음에는 첫 페이지만 생성하고 이후 페이지는 요청할 때 생성합니다. 준비 중이면 잠시 기다리거나 같은 페이지를 다시 여세요. 완성된 PDF는 기다리지 않고 받을 수 있습니다.

- **웹 앱.** 결과 화면에서 원하는 페이지의 미리 보기를 선택합니다.
- **CLI.** 다음 예제는 2페이지와 5페이지의 PNG를 받습니다. 파일은 `.render/previews/page-2.png`와 같은 이름으로 저장됩니다.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## 수식과 TikZ 그림을 SVG로 저장하기 {#数式と-tikz-を-svg-で保存する}

가장 바깥쪽 수식과 최상위 TikZ 그림을 각각 독립된 벡터 이미지(SVG)로 추출할 수 있습니다.

- **웹 앱.** 변환 전 **저장 위치 및 출력 옵션**에서 **수식과 TikZ도 SVG로 출력**을 선택합니다. 완료 후 결과 화면의 **SVG 결과 파일**에서 내려받습니다.
- **CLI.** `--svg`를 지정하여 변환합니다. 각 SVG는 `.render/svg/objects/`에 저장됩니다. 원본 `.tex`의 줄 번호와 PDF 좌표에 대응하는 정보는 `.render/svg/manifest.json`에서 확인할 수 있습니다.

```sh
n624-latex render . --svg
```

## PDF는 있지만 SVG 추출에 실패한 경우 {#pdf-はあるが-svg-が失敗した場合}

**부분 성공**은 PDF는 완성됐지만 SVG 추출에 실패한 상태입니다. PDF를 먼저 저장한 뒤 PDF를 다시 컴파일하지 않고 SVG 추출만 재시도할 수 있습니다.

- **웹 앱.** 결과 화면에서 **SVG만 재시도**를 누릅니다.
- **CLI.** 다음 명령을 실행합니다.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**재시도 조건과 횟수**
- 원래 입력과 확정된 PDF가 남아 있고 서버의 TeX 실행 환경이 그대로라면 처음 시도를 포함해 **최대 8회**까지 실행할 수 있습니다. 재시도해도 보관 기한은 늘어나지 않습니다.
- 계속 실패하면 결과 페이지의 진단 정보나 `.render/svg/errors.json`을 확인하세요.
- `SVG_RUNTIME_CHANGED`가 표시되거나 이전 작업에 재시도 버튼이 없다면 [원본 문서 또는 저장된 버전에서 새 변환을 시작](/ko/docs/web/#以前の文書や結果を開く)하세요.

[HTTP API에서 결과 받기와 재시도](/ko/docs/api/#pdfの先行公開とsvgの再試行) 및 [출력 처리 구현 규격](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md)을 참고하세요.
