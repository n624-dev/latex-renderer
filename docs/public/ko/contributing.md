---
slug: contributing
category: 개발 및 기여
title: 문서에 기여하기
description: Markdown 원고를 수정하고 변경 사항을 로컬에서 검증합니다.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## 본문 수정 {#本文を編集する}

- **오류 제보.** 설명이 실제 화면이나 명령과 다르면 [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose)에 해당 페이지와 수정 제안을 알려 주세요.
- **풀 리퀘스트 제출.** 직접 수정하려면 [공개 가이드 Markdown 원고(`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public)의 해당 파일을 편집한 뒤 풀 리퀘스트를 제출하세요.

## 로컬 검증 {#ローカル検証}

다음 명령을 실행해 빌드와 링크 및 헤더 검사를 통과하는지 확인합니다.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

`public-web` 빌드는 Wrangler dry-run 후 로컬 Workers 런타임을 시작해 대표 페이지, 검색 색인, 404, 리디렉션 및 응답 헤더를 자동으로 검증합니다.

## 호환성 {#互換性}

- 기존 공개 URL 경로와 제목 앵커(제목에서 생성되는 `#...` 조각)를 보존하세요. 제목을 바꾸면 다른 페이지에서 연결된 링크를 확인합니다.
- CLI 옵션이나 HTTP API 요청 예제를 수정할 때는 구현 코드 및 OpenAPI 정의와도 일치하는지 확인하세요.
