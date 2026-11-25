---
slug: reference
category: 운영 및 개발
title: 운영 및 개발 상세 규격
description: 클라이언트 저장과 복구, MCP 인증 및 이전 버전 마이그레이션을 살펴봅니다.
navOrder: 90
updated: "2026-11-22"
since: "v1.0.0"
---

## 결과 파일 저장 및 복구 {#成果物の保存-復旧の仕様}

> [!DETAILS] 규격 및 절차
>
> - **디렉터리 원자적 교체.** CLI 및 Local MCP는 `.render/result.pdf`, `job.json`, 미리 보기 등의 경로를 유지합니다. 모든 파일의 명시된 크기와 SHA-256을 검사하고 한 세트가 완성되면 디렉터리를 교체합니다. 파일을 하나씩 덮어쓰지 않습니다. 교체 순간에는 디렉터리가 잠시 보이지 않을 수 있으므로 외부 프로그램은 명령이 완료된 뒤 읽으세요.
> - **자동 복구.** 출력 디렉터리 옆에 `<출력명>.latex-renderer-state` 관리 디렉터리를 만들며 입력 소스 수집에서 자동 제외합니다. 정상 종료 시 임시 데이터를 지우고, 강제 종료 시 다음 다운로드 시작 때 복구합니다. 커밋 전에는 이전 세트로 복원하고 이후에는 새 세트를 유지한 채 이전 세트를 정리합니다. 처리 중이나 복구 전에는 관리 디렉터리를 지우지 마세요.
> - **잠금과 이상 탐지.** 같은 경로에 동시에 저장하면 `OUTPUT_BUSY`로 중지합니다. 경과 시간만으로 실행 중 프로세스를 배제하지 않으며 PID 재사용 시에도 안전하게 멈춥니다. 관리 정보 손상, 알 수 없는 파일, 외부 링크가 발견되면 자동 삭제하지 않고 확인을 요청합니다.
> - **사용자 파일과 환경 제한.** 출력 디렉터리에 둔 일반 사용자 파일은 새 세트로 복사합니다. 다운로드 중 수정이 감지되면 교체를 중지하고 편집 내용을 보존합니다. 전용 출력 디렉터리를 사용하는 편이 좋습니다. 이전·새 세트 각각 1 GiB 및 10,000개 항목까지 허용하며 두 세트와 임시 공간을 함께 담을 공간이 필요합니다. 로컬 파일시스템만 지원합니다. 심볼릭 링크, 하드 링크, 다른 파일시스템 마운트가 포함된 경로는 거부합니다. 네트워크 공유에서의 잠금이나 전원 장애 시 완전한 원자성은 보장하지 않습니다. Windows에서 열린 파일이 교체를 막으면 이전 세트를 유지합니다.

## 웹 인증 경계 {#web認証の境界}

> [!DETAILS] 규격 및 절차
>
> `/app/`, `/admin/`와 그 API는 서버 세션으로 보호하며 공개 검색 색인에 포함하지 않습니다. 일반 사용자는 `/app/`, 관리자와 소유자만 `/admin/`에 접근할 수 있습니다. 신원은 외부 IdP의 `issuer + subject` 또는 암호 인증의 `login name`으로 식별하며 이메일이나 표시 이름을 인증 키로 쓰지 않습니다. ZIP 업로드, 작업, 결과, TeX 컴파일은 모두 서버의 렌더러에서 처리합니다.
>
> > [!NOTE]
> > 작업 접속용 단기 티켓은 브라우저에 영구 저장하지 않고 필요할 때 서버 세션을 통해 재발행합니다. 세션 쿠키, CSRF 토큰 및 단기 티켓을 복사하여 공유하지 마세요.

## Remote MCP 등록 및 진단 {#remote-mcpの登録-診断}

> [!DETAILS] 규격 및 절차
>
> - **동적 클라이언트 등록(DCR)의 보관과 제한.** 완료되지 않거나 비활성인 등록은 대체로 30일 후 정리합니다. 유효한 승인 코드나 토큰 패밀리가 참조하는 등록은 보호합니다. 전체 한도는 10,000개입니다. 정리 후 `invalid_client`가 발생하면 AI 클라이언트에서 다시 등록하세요. 클라이언트 이름이 생략된 표준 DCR 요청도 허용하며 이름과 리디렉션 URI 검증은 유지합니다.
> - **승인 요청 임시 저장(스키마 20).** 브라우저 로그인이 필요한 승인 요청은 짧은 임의 ID로 임시 저장합니다. 긴 OAuth `state`를 로그인 복귀 URL에 다시 넣지 않고 요청을 복원합니다. 10분간 유효하며 인증된 브라우저와 전용 쿠키가 일치할 때 한 번만 사용합니다. 병렬 탭은 별도 ID를 사용합니다. 전체 1,000개, 브라우저당 연속 처리 쿠키 8개까지 허용합니다. 한도에서는 기존 요청을 보존하고 `503`을 반환합니다. DB에는 ID와 쿠키 해시만 저장하며 재시작이나 백업 복원으로 기한이 늘어나지 않습니다.
> - **IP 속도 제한과 출처 헤더.** 신뢰하는 출발지 IP당 15분에 10번까지 DCR 등록을 허용합니다. 같은 프록시 출구 IP는 한도를 공유합니다. 11번째부터 HTTP `429`, `temporarily_unavailable`, `Retry-After`를 반환합니다. 잘못된 등록 메타데이터는 한도를 소비하지 않습니다. 출발지 IP가 없거나 잘못되면 공통 한도에 합치지 않고 `503`을 반환하므로 프록시 설정을 확인하세요. 백엔드는 루프백에 유지하고 프록시가 `X-Latex-Renderer-Client-IP`를 실제 출발지로 덮어쓰도록 합니다. 임의의 `X-Forwarded-For` 값은 사용하지 않습니다. Cloudflare 경로에서는 신뢰 경계 내의 `CF-Connecting-IP`도 처리합니다.
> - **관리자 연결 점검.** 아래 명령은 자격 증명 전송 없이 공개 검색 응답과 `401` Bearer 챌린지를 확인합니다. 설정을 바꾸거나 리디렉션을 따라가지 않으며 본문·쿠키·비밀값을 출력하지 않습니다.
>   ```sh
>   node deploy/scripts/check-remote-mcp.mjs https://your-renderer.example
>   ```
> - **단계별 로그 확인.** 검색 응답 `200` 및 `401` 챌린지가 정상이어도 실제 로그인이나 ChatGPT의 도구 목록은 따로 확인해야 합니다. 중단 단계, 시각, `X-Request-ID`를 서버의 `remote_mcp.http_result`, `remote_mcp.oauth_stage`, `remote_mcp.protocol_error`, `remote_mcp.rpc_result` 로그와 대조합니다. OAuth 코드, 토큰, 쿠키, PKCE verifier, 소스, 사용자 ID를 로그나 이슈에 노출하지 마세요.
> - **인증은 성공했지만 작업 검색이 실패할 때.** 토큰 발행 후 `initialize`, 초기화 알림, `tools/list`를 구분하여 확인합니다. HTTP `200`여도 JSON-RPC `error`이면 실패입니다. `remote_mcp.rpc_result`는 HTTP 상태, 성공 여부 분류, 프로토콜 버전, 도구 수, 응답 바이트 수, 목록의 기본 형태를 기록합니다. 검사 버퍼 한도는 256 KiB이며 초과 시 `inspection_limited`만 기록하고 응답 본문은 그대로 전달합니다. SSE 응답이나 `GET`에 대한 `405`만으로 문제라고 판단하지 말고 `Accept`, `Content-Type`, 프로토콜 협상 및 프록시를 통한 요청 도달 여부를 확인하세요. 로컬 HTTP 테스트와 별도로 실제 환경의 외부 OIDC, Cloudflare 정책, 실제 ChatGPT 계정도 점검해야 합니다.

## MCP 결과와 리소스 {#mcpの結果とresource}

> [!DETAILS] 규격 및 절차
>
> Remote MCP 응답은 세 층으로 구성됩니다.
> 1. **표준 `content`**에는 AI가 판단하고 다음 도구를 호출하는 데 필요한 소스 ID, 작업 ID, 상태, 오프셋, 커서, 가용성 및 제한된 진단이 포함됩니다. `structuredContent`나 사용자 지정 리소스를 지원하지 않는 클라이언트에서도 생성부터 수정과 재렌더링까지 완료할 수 있습니다.
> 2. **`structuredContent`**는 검증된 전체 결과를 기계 처리용 객체로 제공합니다.
> 3. **MCP 리소스(`latex-renderer://jobs/...`)**는 PDF 본문, 전체 `compile.log`, 원시 JSON, `svg/manifest.json`, `svg/objects/*.svg` 등 큰 데이터를 제공합니다. 같은 OAuth 소유자만 읽을 수 있으며 일반 결과 파일과 같은 보관 및 크기 제한을 적용합니다. 모든 층에서 API 키, OAuth 토큰, 티켓, 소스 본문 및 원시 base64를 제외합니다.

## CLI 대기 및 재시도 {#cliの待機と再試行}

> [!DETAILS] 규격 및 절차
>
> 작업 완료 대기 중 일시적인 HTTP `502`, `503`, `504` 또는 잘못된 JSON 응답이 발생하면 같은 작업 상태 조회만 **최대 5회** 재시도합니다. 대기 간격은 1, 2, 4, 8, 8초이며 전체 대기 제한 시간을 연장하지 않습니다. 작업 생성, 업로드, 토큰 갱신, 결과 검증은 자동 재시도하지 않습니다. 인증·권한 오류도 즉시 반환합니다. CLI 대기가 실패해도 서버 작업은 계속될 수 있습니다.

## CLI JSON 형식 {#cliのjson形式}

> [!DETAILS] 규격 및 절차
>
> `--json` 사용 시 표준 출력 형식입니다. API 키, `uploadTicket`, `jobTicket`은 출력하지 않습니다.
>
> - **성공(종료 코드 `0`)**
>   ```json
>   {
>     "success": true,
>     "command": "auth.status",
>     "result": { "configured": true }
>   }
>   ```
> - **CLI 또는 API 오류(종료 코드 `1`)**
>   ```json
>   {
>     "success": false,
>     "command": "auth.login",
>     "error": {
>       "code": "INVALID_API_KEY",
>       "message": "Input is not a render API key",
>       "status": 400
>     }
>   }
>   ```
> - **LaTeX 컴파일 실패 등 작업 오류(종료 코드 `2`).** `result`에 작업 정보와 저장 경로를 포함하고 `success: false`를 반환합니다.

## 이전 버전 마이그레이션 및 특수 복구 {#旧版からの移行と特殊復旧}

> [!DETAILS] 履歴資料　이전 업데이터 마이그레이션 및 압축 해제 오류
>
> ### v1.2.x root 업데이터에서 권한 분리 업데이터로 이전 {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> v1.2.x까지 Update Manager는 root 데몬이었습니다. v1.3.0부터 상주 컨트롤러는 `latex-renderer-update` 사용자로 분리되고 고정된 작업만 받는 단기 root 헬퍼를 사용합니다. 이전 업데이터로 웹 업데이트 시 `Application Update Manager must use a separate non-root build tree`에서 멈출 수 있습니다. 같은 웹 작업을 반복하지 마세요.
>
> 이 일회성 이전에는 [v1.3.6 서버 배포본](https://github.com/n624-dev/latex-renderer/releases/tag/v1.3.6)을 사용합니다. 일반 사용자로 [다운로드 및 검증](/ko/docs/self-hosting/#v1-6-9をダウンロードして検証) 절차를 열고 첫 `version=` 줄을 `version=1.3.6`으로 바꿔 실행합니다. 검증과 압축 해제 중 설정된 `bundle_root`를 같은 터미널에서 그대로 사용합니다.
>
> ```bash
> VERSION=1.3.6
> cd "$bundle_root"
> sudo sh deploy/scripts/bootstrap-update-manager-transition.sh "$VERSION"
> ```
>
> 스크립트는 동일한 불변 릴리스를 root로 다시 받아 다이제스트, 태그·커밋, Sigstore 번들, 아카이브 한도 및 메타데이터를 검증합니다. `gh`는 root 소유이고 그룹이나 기타 사용자가 쓸 수 없는 `/usr/local/bin/gh` 또는 `/usr/bin/gh`만 허용합니다. root 소유 `verified`, 비 root `bootstrap-build`(전용 Corepack shim으로 고정된 pnpm 사용), root 소유 `assembly` 트리를 분리하여 빌드합니다. 공용 변경 잠금을 확보한 뒤에만 기존 관리자를 중지하고 실패하면 다시 시작합니다. 성공 후 아래 명령으로 `User=latex-renderer-update`와 각 서비스의 `active` 상태를 확인한 뒤 일반 웹 또는 Admin CLI 업데이트를 사용하세요.
> 웹이나 API에 sudo 권한이나 GitHub 토큰을 전달하지 않습니다.
>
> ```bash
> readlink -f /opt/latex-renderer/current
> systemctl show latex-renderer-update-manager.service \
>   --property=User --property=ActiveState --property=SubState
> systemctl is-active \
>   latex-renderer-image-manager.service \
>   latex-renderer-api.service \
>   latex-renderer-admin-api.service \
>   latex-renderer-admin-web.service \
>   latex-renderer-worker.service
> ```
>
> ### GNU tar 압축 해제가 Function not implemented로 중단될 때 {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> Ubuntu의 GNU `tar`가 `openat2`를 사용하는 환경에서는 업데이터의 `RestrictSUIDSGID=true` 제한 때문에 계층형 아카이브 해제가 `ENOSYS`(Function not implemented)로 중단될 수 있습니다. 수정 버전은 GNU `tar` 검사와 서명 검증을 유지하면서 압축만 `/usr/bin/bsdtar`로 풉니다. 비어 있는 비공개 준비 디렉터리로 풀며 소유권, ACL, 확장 속성은 가져오지 않습니다. `RestrictSUIDSGID`를 끄거나 시스템 `tar`를 교체하지 않습니다.
>
> 이전 업데이터는 수정본 자체를 풀 때도 실패할 수 있습니다. 작업이 실행 중이지 않고 앱과 DB가 정상이며 암호화 백업을 검증했는지 확인한 뒤 설치된 `bootstrap-v1`으로 **독립 업데이터만 수정 사항을 포함한 공개 릴리스로 먼저 업데이트**합니다.
>
> ```bash
> sudo apt-get install --no-install-recommends libarchive-tools
> VERSION=... # Specify the version of a published immutable release containing the fix
> sudo /usr/local/bin/node \
>   /opt/latex-renderer/updater/bootstrap-v1/updater-bootstrap.mjs upgrade "$VERSION"
> ```
>
> 새 업데이터 버전과 `ready` 및 `pending=false`를 확인한 뒤 동일한 버전을 일반 웹 또는 Admin CLI `update apply`로 앱에 적용합니다.
>
> `v1.4.0-rc.3` 업데이터에서 root로 복사한 번들의 소유자가 비 root로 남아 `Release extraction requires a private regular bundle` 오류가 나는 문제가 알려져 있습니다. 검사를 해제하지 말고 소유권 수정이 포함된 새 공개 릴리스로 업데이터만 먼저 업데이트한 뒤 앱에 적용하세요. root 및 systemd 환경의 압축 해제 검사는 `sudo /usr/local/bin/node deploy/ci/restricted-release-extraction.mjs`로 따로 실행할 수 있습니다.

> [!DETAILS] 업데이트 또는 TeX 변경 잠금 조사
>
> ### 변경 잠금이 사용 중일 때 {#mutation-lockが使用中と表示される場合}
>
> `MUTATION_LOCK_BUSY`는 앱 업데이트와 TeX 변경을 동시에 실행하지 못하게 하는 잠금입니다. 작업 진행 중에는 완료를 기다리세요. **`/run/latex-renderer/mutation.lock` 파일 자체를 절대 지우지 마세요.** 지우면 이전 잠금과 새 잠금이 동시에 존재하게 됩니다. 앱 업데이트가 내부 TeX 런타임을 복원하는 중 발생했다면 자체 경합일 수 있으니 재실행 전에 로그와 중지된 서비스를 확인하세요.
>
> 실행 중인 작업이 없고 로그상 이전 작업도 끝났는데 잠금이 남은 경우에만 두 관리자를 중지하고 잠금 보유 프로세스를 확인합니다.
>
> ```bash
> sudo systemctl stop latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> sudo fuser --verbose /run/latex-renderer/mutation.lock
> ```
>
> 해당 프로세스가 완료된 작업에서 남은 고립된 lock helper임을 확인한 경우에만 종료하고 관리자를 다시 시작합니다.
>
> ```bash
> sudo fuser --kill /run/latex-renderer/mutation.lock
> sudo systemctl start latex-renderer-image-manager.service \
>   latex-renderer-update-manager.service
> ```

## 이전 릴리스 후보의 렌더러 식별 정보 {#過去rcのrenderer識別情報}

> [!DETAILS] 履歴資料　v1.3.4 릴리스 후보
>
> `v1.3.4-rc.3`에서 `v1.3.4-rc.4`로 업데이트할 때 렌더러 식별 해시의 대상 파일이 5개에서 6개로 바뀌어 서비스 전환 전에 실패했습니다. 이 조합은 이전 버전 호환 정보를 포함하는 `v1.3.4-rc.5`로 이전합니다. 배포본 전체 체크섬과 출처 서명으로 추가 파일도 검증합니다.

## 업데이터 실행 영역 {#updaterの実行領域}

> [!DETAILS] 규격 및 절차
>
> Update Manager는 검증된 배포본의 root 소유 `verified` 트리, 의존성 설치와 빌드만 하는 비 root `build` 트리, 허용된 결과만 돌려받는 root 소유 `assembly` 트리를 엄격히 분리합니다. root가 실행하는 배포 스크립트는 항상 `assembly`의 검증된 복사본입니다. 배포 사용자로 Cloudflare 공개 등을 수행할 때도 root 검사 후 임시 `deployment-build` 복사본을 사용합니다. 롤백도 같습니다.

## Windows 설치 경로와 보호 {#windowsの配置と保護}

> [!DETAILS] 규격 및 절차
>
> Windows 설치 경로를 바꾸면 기본 명령 위치도 그 아래의 `bin`이 됩니다. `LATEX_RENDER_BIN_DIRECTORY`를 지정하면 해당 위치에 관리 대상 실행기를 두어 사용자 PATH와 Local MCP가 함께 사용합니다. 다른 실행기는 보존합니다. 이전 설치의 경로 기록은 `setup repair`로 수정할 수 있지만 다른 프로그램에 영향을 주지 않도록 기존 PATH 항목은 유지합니다. 세미콜론, 따옴표, 제어 문자가 없는 절대 경로를 사용하세요. `--open`이나 GUI가 브라우저나 뷰어를 열지 못해도 저장된 PDF는 보존됩니다.

## 저장 프로젝트 공유와 보관 {#保存プロジェクトの共有-保持}

> [!DETAILS] 공유 및 보관 규격
>
> - 웹(`/app/`), CLI, 공개 API, Local MCP 및 Remote MCP는 같은 사용자 소유의 프로젝트와 변경 불가능한 버전 기록을 공유합니다. 같은 사용자의 여러 API 키나 서비스 계정에서도 조회·수정할 수 있습니다. 프로젝트에 저장하지 않는 임시 소스·작업 흐름과 병행할 수 있습니다.
> - 입력, 메인 문서, 엔진, 출력 형식의 조합으로 버전을 구분합니다. 출력 형식이 달라도 동일 입력을 공유할 수 있습니다. **다시 변환**에서 고른 형식은 이번 실행에만 적용하며 초기 설정을 고르면 버전에 저장된 형식을 사용합니다.
> - 유효한 프로젝트 버전이 참조하는 소스는 고립 보관 기한을 지나도 유지되며 사용자 저장 용량에 포함됩니다. 프로젝트를 삭제하면 기록을 숨깁니다. 마지막 참조 프로젝트가 삭제되고 참조 작업도 없어지면 보호가 해제되어 기한 후 정기 정리에서 회수됩니다. 즉시 완전 삭제해야 한다면 관리자에게 문의하세요.

## 표시 언어 {#表示言語}

편집기의 **표시 언어**는 계정에 저장됩니다. 미설정 시 브라우저 언어를 순서대로 확인하며 지원 언어가 없으면 영어로 표시합니다. 문서 엔진과 인코딩은 별도로 설정합니다.

| 대상 | 번역 범위 |
| --- | --- |
| 웹 및 설정 | 작업, 실행 상태, 확인 및 진단을 표시합니다. |
| CLI 및 MCP | CLI 도움말과 안내에는 터미널 언어를 사용합니다. 원격 MCP 설명에는 계정 언어를 사용합니다. |
| 편집기 | 편집, 검색·바꾸기, 저장·충돌, 컴파일 상태, 미리 보기 조작을 18개 언어로 제공합니다. |
| 공개 가이드 | 모든 가이드는 아래 18개 언어로 제공됩니다. 페이지 상단의 표시 언어 메뉴에서 선택하세요. |

편집기는 영어, 일본어, 중국어 간체, 한국어, 스페인어, 포르투갈어, 프랑스어, 독일어, 이탈리아어, 러시아어, 튀르키예어, 폴란드어, 체코어, 네덜란드어, 스웨덴어, 노르웨이어(부크몰), 덴마크어 및 핀란드어를 지원합니다. TeX 자체와 서드파티 패키지 로그는 오류 조사에 쓰도록 원문을 표시합니다.

## 감사 로그 복구 {#監査ログの復旧}

DB 복원 등으로 감사 로그 내보내기 위치 기록(`export_database_id`, 행 순번 `export_sequence`, `export_token`)과 DB 상태가 어긋나면 보호를 위해 내보내기와 정리가 중단됩니다.

1. 조사와 복구 중 감사 로그 내보내기 및 정리 서비스와 타이머를 중지합니다.
2. 복원된 DB, 기존 암호화 내보내기 파일, 현재 및 이전 형식의 체크포인트를 모두 별도 위치에 보존합니다. 복구 대상 DB의 무결성, 외래 키 및 마이그레이션 상태를 검증합니다.
3. 일치하는 체크포인트가 없고 DB에 남은 감사 행을 다시 내보내기로 결정했다면 체크포인트 파일을 유효 경로 밖으로 옮깁니다. `AUDIT_EXPORT_CHECKPOINT`를 지정한 경우 그 경로도 확인합니다. DB의 감사 행, SQLite 순번 및 `export.lock`은 보존합니다.
4. 운영 서비스와 같은 자격 증명으로 내보내기를 한 번 수동 실행합니다. 암호화 파일이 복호화되고 형식 3인 새 체크포인트가 생성됐는지 확인한 뒤 타이머를 재개합니다.

복원된 DB에 남아 있는 행만 다시 내보냅니다. 기존 출력과 중복을 판별하려면 시각이 아닌 `export_database_id`, `export_sequence`, `export_token`의 조합을 비교하세요.
