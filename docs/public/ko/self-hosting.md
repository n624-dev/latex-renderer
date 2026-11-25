---
slug: self-hosting
category: 자체 호스팅
title: 자체 서버에서 운영하기
description: 지원되는 서버 구성과 준비 사항을 확인하고 초기 설정, 업데이트 및 백업을 수행합니다.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## 설치 옵션 {#現在の提供状況}

새 서버는 [APT 패키지](/ko/docs/client/#debian-ubuntu-の-apt-パッケージ)와 설정 마법사로 구축할 수 있습니다. 마법사에서 HTTPS, 로그인 방식 및 첫 소유자 계정을 설정합니다.

### 첫 설치 순서 {#初回導入の順序}

1. **서버 준비.** [지원 OS와 공개 방식](#対応する構成)을 확인하고 [Docker Engine 및 Nginx를 준비](#準備するもの)합니다.
2. **APT 패키지 설치.** [Debian 및 Ubuntu 설치 방법](/ko/docs/client/#debian-ubuntu-の-apt-パッケージ)에 따라 `n624-latex`를 설치합니다.
3. **서버 구축.** root가 아닌 배포용 계정에서 `sudo n624-latex server setup --plan`을 실행합니다. 누락된 항목을 준비한 뒤 [브라우저에서 설정](/ko/docs/server-setup/#ブラウザで開く)을 진행합니다.
4. **첫 PDF 생성.** 구성한 HTTPS URL을 열어 [로그인하고 테스트 문서를 변환](#導入完了の確認)합니다. 첫 TeX 런타임은 설정 과정에서 준비됩니다.

기존 서버는 [관리 화면에서 업데이트](/ko/docs/updates/)하세요. tarball을 사용한다면 [수동 배포 절차](#v1-6-9をダウンロードして検証)를 따르세요.

## LAN 자동 HTTPS {#lan-内の自動-https}

LAN에서는 **Akebi**로 사설 IP 주소에서 정해지는 HTTPS URL을 설정할 수 있습니다. 공용 인증서 서비스로 시작하려면 [LAN에서 HTTPS 사용하기](/ko/docs/lan-https/)를 참고하세요.

## 지원 구성 {#対応する構成}

APT 신규 설치는 `systemd`를 실행하는 단일 호스트에서 지원합니다. 지원 OS는 Debian 12·13 또는 Ubuntu 24.04·26.04이며 아키텍처는 amd64와 arm64입니다. LaTeX 변환은 전용 사용자의 rootless Docker에서 실행합니다.

| 배포 모드(`DEPLOYMENT_MODE`) | 인그레스 | 로그인 방식 |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache 또는 LAN HTTPS(Akebi) | 로컬 암호, OIDC 또는 둘 다 |
| `cloudflare` | Cloudflare Tunnel 및 Worker | Cloudflare Access 또는 네이티브 인증(암호, OIDC 또는 둘 다) |

- **OIDC.** 조직이 운영 중인 ID 제공자(IdP)를 사용할 때 적합합니다.
- **Cloudflare Access.** Cloudflare에 사용자용 Access Application을 준비합니다.
- **로컬 암호.** 외부 IdP 없이 서버 관리 화면에서 사용자를 등록합니다.
- **암호와 OIDC 병행.** 네이티브 인증에서 `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true`, `AUTH_OIDC_ENABLED=true`로 둘 다 사용할 수 있습니다. 이전 단일 인증 방식은 `AUTH_MODE`로 지정합니다.

## 서버 준비 {#準備するもの}

- **작업 계정.** root가 아닌 계정으로 연결하여 서버 설정 명령을 `sudo`로 실행합니다.
- **디스크.** 초기 검사에서 `/opt`와 `/var/lib`가 있는 각 파일시스템에 **5 GiB 이상**의 여유 공간이 필요합니다. TeX 이미지, 릴리스, 결과 파일 및 암호화 백업을 위한 공간도 추가로 확보하세요.
- **Docker Engine.** 공식 저장소에서 Docker Engine과 `docker-ce-rootless-extras`를 설치합니다. 마법사가 변환용 rootless Docker를 구성합니다. [Debian 공식 안내](https://docs.docker.com/engine/install/debian/) 또는 [Ubuntu 공식 안내](https://docs.docker.com/engine/install/ubuntu/)를 참고하세요.
- **Nginx.** `sudo apt install nginx`로 설치합니다. Caddy, Apache 또는 Cloudflare로 공개하더라도 APT 버전 신규 설치에서는 Nginx 설치 여부를 검사합니다.
- **인그레스 및 TLS.** 사용자 지정 HTTPS에는 호스트 이름, 인증서, 개인 키를 준비하고 내장 HTTPS가 사용할 주소 및 포트를 비워 둡니다. Cloudflare를 사용하면 Tunnel, DNS, Worker를 준비합니다. [LAN HTTPS 요건](#lan-内の自動-https)도 참고하세요.
- **인증 정보**
  - OIDC에는 issuer URL, 클라이언트 ID와 시크릿, 첫 소유자의 고정 `subject`가 필요합니다.
  - Cloudflare Access에는 Access Application 정보와 소유자의 `subject`가 필요합니다.
  - 암호 방식에는 소유자 로그인 이름 및 초기 암호가 필요합니다.
- **외부 접속.** 서버는 GitHub Releases/Attestations, GHCR(`ghcr.io`), TeX Live 아카이브 및 Debian이나 Ubuntu 패키지 저장소에 HTTPS로 접근할 수 있어야 합니다.
- **APT 패키지.** Node.js는 패키지에 포함됩니다. [APT 설치 안내](/ko/docs/client/#debian-ubuntu-の-apt-パッケージ)를 참고하세요.

## 설치 완료 확인 {#導入完了の確認}

1. 구성한 HTTPS URL의 `/admin/`을 열고 설정 시 등록한 소유자로 로그인합니다.
2. 같은 HTTPS URL의 `/app/`에서 [예제 `main.tex`](/ko/docs/#最短でpdfを作る)를 선택한 뒤 **PDF로 변환**을 누릅니다.
3. 결과 화면에서 PDF를 열어 예제 본문이 표시되는지 확인합니다.

> [!DETAILS] 서비스와 출력 추가 검증
>
> 관리자는 공개 URL을 통해 변환하는 스모크 테스트를 실행할 수 있습니다. 테스트가 발급한 API 키는 직후 폐기합니다.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> 일반 사용자 로그인, 공개 가이드, TeX 환경의 언어와 이미지 및 일본어 문서나 SVG 등 실제 운영에 필요한 출력도 확인할 수 있습니다.

### 사용자 등록 및 API 키 발급 {#利用者と-api-キーの発行}

소유자로 `/admin/`에 로그인할 수 있으면 사용자를 등록합니다.

- **웹 및 Remote MCP 사용자.** 관리 화면의 **사용자**에서 계정을 만들고 로그인 방식에 맞는 식별 정보를 등록한 뒤 웹 앱 URL을 안내합니다.
- **CLI, Local MCP, HTTP API 사용자.** 사용자에게 연결된 **서비스 계정**을 만든 뒤 **API 키 → API 키 발급**에서 `render:create` 및 `render:read:own` 범위를 가진 렌더링 키(`lrk_...`)를 발급하여 안전한 경로로 전달합니다.

## 업데이트와 롤백 {#更新とロールバック}

### 애플리케이션 업데이트 {#アプリケーションを更新する}

- 앱을 업데이트하려면 소유자로 **관리 → 업데이트**를 엽니다. [정식 버전 업데이트 및 롤백](/ko/docs/updates/)을 참고하세요.
- TeX Live 버전이나 언어를 바꾸려면 **관리 → TeX 환경**을 엽니다. [TeX 환경 설정](#tex環境の初期設定)을 참고하세요.

> [!DETAILS] 履歴資料　이전 버전 이전 및 특수 복구 절차
>
> ### v1.2.x root 업데이터에서 권한 분리 업데이터로 이전 {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> [권한 분리 업데이터 이전 절차](/ko/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合)를 참고하세요.
>
> ### GNU tar 압축 해제가 Function not implemented로 중단될 때 {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> [압축 해제 오류 점검](/ko/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合)을 참고하세요.
>
> ### 변경 잠금이 사용 중일 때 {#mutation-lockが使用中と表示される場合}
>
> [잠금 보유 프로세스 확인](/ko/docs/reference/#mutation-lockが使用中と表示される場合)을 참고하세요.

## 백업 {#バックアップ}

정기 백업 및 업데이트 직전 복구 지점 생성, 복원 테스트, 데이터 복구는 [백업 생성, 검증 및 복구](/ko/docs/backups/)를 참고하세요. 복원 후 감사 내보내기 위치가 어긋나면 [감사 로그 복구](/ko/docs/reference/#監査ログの復旧)를 따르세요.

## 문제 해결 {#問題が起きた場合}

| 증상 | 먼저 확인할 사항 |
| --- | --- |
| `/app/`에 접근할 수 없음 | DNS, TLS 인증서, Tunnel/리버스 프록시 설정, 루프백 서비스 시작 순서 |
| 관리자만 로그인할 수 없음 | 소유자에게 등록한 identity/credential, `AUTH_MODE`, issuer와 audience, 역할 설정 |
| TeX 이미지를 받을 수 없음 | `ghcr.io` HTTPS 접속, 패키지 공개 여부, 지정 태그의 아키텍처 지원 |
| TeX 변경이 오래 걸림 | 작업 ID 및 Image Manager의 민감 정보가 제거된 로그 |
| 앱 업데이트 거부 | 대상 릴리스의 불변 여부, 에셋 다이제스트, 업그레이드 경로, 디스크 여유 공간 |
| 호스트 초기화가 unsafe path에서 중단됨 | `/var/lib/latex-renderer`의 소유권이 `root:latex-renderer`이고 모드가 `2770`인지 확인 |
| 업데이트 화면만 시작되지 않음 | 릴리스의 `client-dist/manifest.json` 존재 여부 및 Admin Web 서비스 상태 |
| 렌더링이 시작되지 않음 | 큐 상태, 여유 디스크 5 GiB 이상, 워커 서비스, rootless Docker 소켓 |
| 업데이트 직후 문제 발생 | 새 작업 접수를 중단하고 이전·새 릴리스 및 런타임을 확인한 뒤 롤백 여부 결정 |

조사할 때는 작업 ID, 실패 단계, 공유해도 안전한 오류 코드를 기록하세요. [문제 해결](/ko/docs/troubleshooting/), [계정과 문서 보안](/ko/docs/security/), [배포 구성과 설정 파일 목록(DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md)도 참고할 수 있습니다.

## TeX 환경 변경 {#tex環境の初期設定}

초기 설정에서 변환용 TeX 환경을 준비합니다. 언어를 추가하거나 TeX Live 버전을 바꾸려면 **관리 → TeX 환경**(`/admin/tex-environment/`)을 엽니다. 아래는 영어 및 일본어 설정 예제입니다.

| 항목 | 권장값 |
| --- | --- |
| Image | `latest`(날짜 고정 태그를 사용하려면 호스트 아키텍처 지원 버전을 지정) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off(기본 비활성) |

- 공개 GHCR 패키지에서 받는 것은 언어를 포함하지 않는 **기본 이미지**뿐이며 받은 뒤 다이제스트로 고정합니다. 서버에서 선택한 언어와 현재 렌더러 코드를 더해 **런타임 이미지**를 빌드합니다. 동일 구성의 로컬 런타임이 있으면 재사용하며 런타임은 외부에 공개하지 않습니다.
- 브라우저를 닫아도 빌드는 계속됩니다. 완료 후 관리 화면에서 활성 런타임과 언어를 확인하세요. 가져오기 실패 시 `ghcr.io` HTTPS 연결 및 지원 아키텍처를 확인합니다.

### 자동 용량 정리 {#自動容量整理}

> [!DETAILS] 미사용 이미지 및 빌드 캐시 자동 정리
>
> Image Manager는 기본적으로 24시간마다 사용하지 않는 관리 대상 이미지를 정리합니다. 현재와 직전 롤백용 기본 이미지·런타임 및 설정에서 참조하는 이미지는 보호합니다. 나머지 관리 이미지는 생성 후 24시간부터 삭제 대상이며 미사용 빌드 캐시는 2 GiB를 기준으로 정리합니다. Docker 전체 용량 상한은 아닙니다.
>
> `/etc/latex-renderer/renderer.env`에서 조정할 수 있습니다. TeX 업데이트 중이 아닐 때 `sudo systemctl restart latex-renderer-image-manager.service`로 적용합니다.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS`는 `0`이면 자동 정리를 끄고, 그 외에는 `1`~`720`시간으로 설정합니다. 시작 5분 후부터 5분마다 정리 시점을 검사하고 업데이트·배포 중에는 공용 잠금으로 연기합니다. 웹/CLI의 수동 정리는 보관 기간을 기다리지 않고 보호 대상 밖의 항목을 정리합니다.
> - `RETENTION_HOURS`는 `0`~`8760`시간, `BUILD_CACHE_MAX_GIB`는 `0`~`1024` GiB입니다.
> - `1.3.4-rc.2`부터 비 root Docker의 Buildx 메타데이터를 워커 홈의 `.docker/buildx-worker`에 분리해 root 빌드와 권한 충돌을 방지합니다. 이전 구성 이미지 및 수동 복구 디렉터리는 자동 정리되지 않습니다. 불필요함을 확인한 항목만 개별 삭제하고 Docker 데이터 디렉터리 자체는 직접 삭제하지 마세요.

## sudo와 일반 운영의 경계 {#sudoと通常運用の境界}

초기 설정에서 시스템 사용자, 디렉터리, `systemd` 유닛, rootless Docker, 비밀 키 파일을 준비하기 위해 `sudo`를 사용합니다. **설치 후 일반 운영에서는 웹이나 Admin API에 `sudo` 권한을 부여하지 않습니다.**

- **TeX 환경 변경**은 권한이 제한된 Unix 소켓으로 root 소유 Image Manager에 요청합니다.
- **앱 업데이트**는 Unix 소켓으로 비 root Update Manager 컨트롤러에 요청하며 고정된 작업만 단기 root 헬퍼에 위임합니다.
- **상호 배제.** TeX 변경과 앱 업데이트는 공용 호스트 잠금으로 직렬화합니다. 웹/API에서 임의의 명령, 경로 또는 URL을 root로 넘길 수 없습니다.

## 설정과 비밀 정보 {#設定と秘密情報}

호스트 전용 설정과 비밀 정보는 앱과 Git 작업 트리 밖에 저장합니다(예: `/etc/latex-renderer/`).

| 경로 | 내용 | 권장 모드 |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | 공개 모드, URL, 제한, 비밀이 아닌 IdP 설정 | `0640` |
| `/etc/latex-renderer/deployment.env` | Cloudflare 프로필 전용 식별자 및 토큰 | `0600` |
| `/etc/latex-renderer/update-manager.env` | 비 root 배포 사용자 설정 | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | 운영 Worker 바인딩 및 경로 | `0600` |
| `/etc/cloudflared/config.yml` | Cloudflare Tunnel 인그레스 설정 | `0640` |
| `/etc/latex-renderer/secrets/` | pepper, 티켓 키, 관리자 자격 증명 | 파일별 지정 |
| `/etc/latex-renderer/secrets/oidc-client-secret` | OIDC 프로필 전용 클라이언트 시크릿 | `0440` |

> [!WARNING]
> `.env`, Cloudflare 토큰, Tunnel 자격 증명, API 키, SQLite DB, 사용자 문서, PDF, 편집하지 않은 실제 로그를 Git에 커밋하거나 이슈·지원 요청에 붙이지 마세요. 저장소의 `*.example`은 항목 확인용 템플릿입니다.

## tarball 수동 설치와 이전 버전 배포 {#手動配置-旧版向けの構築手順-tarball-導入}

APT 패키지와 `sudo n624-latex server setup`를 쓰는 표준 설치에서는 마법사가 아래의 압축 해제, 호스트 준비, 소유자 등록을 안내하거나 처리합니다. `v1.7.1` 배포본을 수동 설치하거나 공개 경계 및 인증 변경을 검토하려면 아래 절차를 여세요.

> [!DETAILS] v1.7.1 수동 다운로드, 검증, 배포 및 소유자 등록
>
> 새 수동 설치에는 정식 릴리스 [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1) 배포 파일 `latex-renderer-server-1.7.1.tar.gz`을 사용합니다. 이 릴리스는 공개 후 태그나 배포 파일을 교체할 수 없습니다. 개발 중인 `main` 브랜치에서 직접 배포하거나 TeX용 `docker build`를 로컬에서 실행하는 것은 일반 운영 지원 범위 밖입니다.
>
> ### v1.7.1 다운로드 및 검증 {#v1-6-9をダウンロードして検証}
>
> `curl`, `jq`, `tar`, `sha256sum` 및 `gh attestation verify`를 지원하는 GitHub CLI를 준비합니다. 서버용 Node.js와 Corepack은 아래 호스트 준비 단계에서 설치합니다.
>
> 일반 사용자로 같은 Bash 세션에서 다음을 실행합니다. GitHub Releases의 SHA-256과 GitHub Actions의 빌드 출처 서명(Attestation)을 모두 검증합니다. 공개 API의 출처 데이터를 `gh`에 넘기므로 GitHub 로그인이나 토큰이 필요하지 않습니다. 중간에 실패하면 `bundle_root`가 설정되지 않으므로 원인을 해결하고 다시 실행하세요.
>
> ```bash
> version=1.7.1
> repository=n624-dev/latex-renderer
> asset="latex-renderer-server-$version.tar.gz"
> unset bundle_root
> work_dir=$(mktemp -d) &&
> bash -euo pipefail -s -- "$version" "$repository" "$asset" "$work_dir" <<'BASH' && bundle_root="$work_dir/latex-renderer-server-$version"
> version=$1
> repository=$2
> asset=$3
> work_dir=$4
> release_json="$work_dir/release.json"
>
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/releases/tags/v$version" \
>   --output "$release_json"
> jq -e --arg version "$version" --arg asset "$asset" '
>   .immutable == true and
>   .tag_name == ("v" + $version) and
>   any(.assets[]; .name == $asset and (.digest | test("^sha256:[a-f0-9]{64}$")))
> ' "$release_json"
>
> asset_url=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .browser_download_url' "$release_json")
> asset_digest=$(jq -r --arg asset "$asset" '.assets[] | select(.name == $asset) | .digest' "$release_json")
> curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
>   "$asset_url" --output "$work_dir/$asset"
> printf '%s  %s\n' "${asset_digest#sha256:}" "$work_dir/$asset" | sha256sum --check -
> attestation_response="$work_dir/attestations.json"
> attestation_bundle="$work_dir/attestations.jsonl"
> curl --proto '=https' --tlsv1.2 --fail --silent --show-error \
>   "https://api.github.com/repos/$repository/attestations/$asset_digest" \
>   --output "$attestation_response"
> jq -ce '.attestations | length > 0' "$attestation_response" >/dev/null
> jq -c '.attestations[].bundle' "$attestation_response" > "$attestation_bundle"
> gh attestation verify "$work_dir/$asset" \
>   --bundle "$attestation_bundle" \
>   --repo "$repository" \
>   --signer-workflow "$repository/.github/workflows/server-release.yml" \
>   --source-ref "refs/tags/v$version" \
>   --deny-self-hosted-runners
>
> tar -xzf "$work_dir/$asset" -C "$work_dir"
> BASH
> ```
>
> ### 호스트 준비 {#ホストを準備}
>
> 저장소 권한 설정을 위한 `setfacl`, 제한된 업데이터 안에서 압축을 풀 `bsdtar`, 배포 ZIP 검사에 쓸 `unzip`을 설치합니다. 공식 절차에 따라 Node.js 26 또는 24(`/usr/local/bin/node`, `/usr/local/bin/corepack`)와 Docker rootless 도구를 준비합니다. `cloudflare` 모드에는 `cloudflared`도 필요합니다. Update Manager는 Corepack을 통해 지정된 pnpm을 배포 사용자에게 설치하고 버전을 대조합니다.
>
> ```bash
> sudo apt-get install --no-install-recommends acl libarchive-tools unzip
> command -v setfacl
> /usr/bin/bsdtar --version
> command -v unzip
>
> /usr/local/bin/node --version
> /usr/local/bin/corepack --version
> command -v dockerd-rootless-setuptool.sh
> # Only for DEPLOYMENT_MODE=cloudflare
> cloudflared --version
> ```
>
> 이어서 일반 배포 사용자로 호스트 초기화 및 `latex-render-worker`의 rootless Docker 설정을 실행합니다.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### 호스트별 설정 만들기 {#ホスト固有設定を作成}
>
> 모든 프로필에서 `renderer.env`를 만들고 `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE`, `AUTH_MODE`를 설정합니다. `ADMIN_ALLOWED_ORIGINS` 같은 다른 키는 없으며 브라우저 작업은 `PUBLIC_ORIGIN`과 정확히 일치하는 출처만 허용합니다.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **`cloudflare` 프로필.** `example.com`, `REPLACE_*`, UUID, Access audience를 모두 실제 환경 값으로 바꿉니다. 원격 관리 Tunnel을 사용할 때는 로컬 `config.yml`을 두지 말고 connector가 활성 상태인지 먼저 확인합니다.
>
> ```bash
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/deploy/deployment.env.example" /etc/latex-renderer/deployment.env
> sudo install -o root -g root -m 0600 \
>   "$bundle_root/apps/gateway-worker/wrangler.example.jsonc" \
>   /etc/latex-renderer/gateway-worker.wrangler.jsonc
> # Only for host-local Tunnel configuration
> sudo install -o root -g cloudflared -m 0640 \
>   "$bundle_root/deploy/cloudflared/config.example.yml" /etc/cloudflared/config.yml
> ```
>
> - **`standalone` 프로필.** Nginx, Caddy, Apache 중 하나를 설치한 뒤 `deploy/reverse-proxy/`의 예제를 복사해 FQDN과 인증서 경로를 지정합니다. 프록시는 수신한 `CF-Access-*` 헤더를 제거하고 클라이언트 IP 헤더를 덮어씁니다. 3100~3105번 포트의 루프백 서비스를 외부에 직접 노출하지 않습니다.
>
> ```bash
> # Nginx example
> sudo install -o root -g root -m 0644 \
>   "$bundle_root/deploy/reverse-proxy/nginx.conf.example" \
>   /etc/nginx/sites-available/latex-renderer.conf
> sudoedit /etc/nginx/sites-available/latex-renderer.conf
> sudo ln -s /etc/nginx/sites-available/latex-renderer.conf /etc/nginx/sites-enabled/latex-renderer.conf
> sudo nginx -t && sudo systemctl reload nginx
> ```
>
> - **`AUTH_MODE=oidc` 사용 시.** IdP에 `https://<PUBLIC_ORIGIN의 호스트>/auth/oidc/callback`를 등록하고 `renderer.env`에 `OIDC_ISSUER` 및 `OIDC_CLIENT_ID`를 설정한 뒤 클라이언트 시크릿은 끝에 줄바꿈 없이 별도 파일에 저장합니다.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### 서비스 배치 {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - 첫 설치 전용 부트스트랩은 공개된 불변 아티팩트를 다시 받아 서명을 검증합니다. root 소유 제어 트리와 비 root 빌드 트리를 분리해 `client-dist`를 빌드하고 `/opt/latex-renderer/releases/$release_id`에 배치합니다. 기존 DB나 `current`가 있으면 거부하므로 설치 후에는 일반 업데이트 기능을 사용하세요.
> - 배치 전 `renderer.env`(root 소유, `0640`, 중복 키 없음), `PUBLIC_ORIGIN`, 인증 설정 및 pepper와 시크릿의 소유권·권한·길이를 검사합니다. 비밀값 자체는 출력하지 않습니다.
> - 업데이터는 `/opt/latex-renderer/updater`에 분리 설치합니다. 자세한 내용은 저장소의 `docs/independent-updater.md`를 참고하세요. 임시 영역 `/opt/latex-renderer/update-staging`은 배포 사용자의 기본 그룹만 통과할 수 있으며 각 단계는 `0700`으로 격리합니다. 정상 종료 시 삭제하고 중단된 작업은 24시간이 지난 뒤 시작할 때 정리합니다.
>
> ### 공개 경계 {#公開境界}
>
> - **`cloudflare-access`.** 동일한 일반 사용자용 Access Application으로 `/auth/*`, `/app/`, `/admin/`, `/oauth/authorize`를 보호하고 오리진에서도 audience를 검증합니다. Cloudflare에서 OIDC 또는 암호를 쓰는 경우 `/auth/*`를 Access로 차단하지 않습니다. 공개 문서와 다운로드에는 인증이 필요하지 않으며 Renderer API의 공개 부분만 Worker Routes로 처리합니다. Tunnel 인그레스는 세부 API·관리 경로, 웹 대체 경로, `http_status:404` 순서로 둡니다.
> - **`standalone`.** TLS 프록시가 경로별로 루프백 서비스에 전달하고 작은 JSON 티켓 작업만 3105번 포트의 Standalone Gateway로 보냅니다. Nginx 예제에는 연결 수와 암호 로그인 및 티켓 API의 속도 제한이 포함됩니다. 기본 Caddy·Apache에는 같은 수준의 클라이언트별 요청 제한이 없으므로 상위 로드 밸런서나 호스팅에서 반드시 속도를 제한합니다. `/internal/*`, DB, 관리자 소켓은 공개하지 않습니다.
>
> ### 첫 소유자 등록 {#最初のowner}
>
> 외부 인증의 고유 키는 `provider + issuer + subject`이며 암호 인증은 `login name`을 사용합니다. 이메일은 표시 속성으로만 쓰며 이메일로 자동 연결하거나 즉시(JIT) 계정을 만들지 않습니다. 선택한 방식의 절차 하나만 한 번 실행합니다.
>
> **Cloudflare Access 또는 OIDC**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> IFS= read -r -p 'Stable subject: ' owner_subject
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_SUBJECT="$owner_subject" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> unset owner_email owner_name owner_subject
> ```
>
> **로컬 암호(로그인 이름 `owner` 예제)**
>
> ```bash
> IFS= read -r -p 'Owner display name: ' owner_name
> IFS= read -r -p 'Owner email (optional): ' owner_email
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   LATEX_RENDER_OWNER_EMAIL="$owner_email" \
>   LATEX_RENDER_OWNER_NAME="$owner_name" \
>   LATEX_RENDER_OWNER_LOGIN_NAME=owner \
>   LATEX_RENDER_OWNER_PASSWORD_FILE="$password_file" \
>   sh /opt/latex-renderer/current/deploy/scripts/bootstrap-owner.sh
> shred -u "$password_file"
> unset owner_email owner_name owner_subject password_file
> ```
>
> ### AUTH_MODE를 나중에 변경할 때 {#後からauth-modeを変更する場合}
>
> [서버 설정 마법사](/ko/docs/server-setup/)를 쓸 수 없을 때 사용하는 절차입니다.
> 먼저 암호화 백업을 만들고 Admin API를 중지합니다. 관리 화면이나 `users list`에서 확인한 불변 `user_...` ID에 새 인증 방식을 추가합니다. 기존 자격 증명 덮어쓰기는 거부하고 기존 브라우저 세션은 폐기합니다. 추가 후 `renderer.env`를 수정해 Admin API와 웹을 재시작합니다. 비공개 창에서 새 방식의 로그인을 확인할 때까지 기존 자격 증명을 삭제하지 마세요.
>
> 다음 준비 명령을 실행한 뒤 대상 방식에 해당하는 명령만 실행합니다.
>
> ```bash
> admin_local=/opt/latex-renderer/current/apps/admin-local/dist/index.js
> IFS= read -r -p 'Owner user ID: ' owner_id
> if [ -f /opt/latex-renderer/current/deploy/scripts/http-services.mjs ]; then
>   sudo node /opt/latex-renderer/current/deploy/scripts/http-services.mjs stop latex-renderer-admin-api.service
> else
>   sudo systemctl stop latex-renderer-admin-api.service
> fi
> ```
>
> **OIDC 또는 Cloudflare Access로 전환할 때**는 `oidc` 또는 `cloudflare-access`를 입력합니다.
>
> ```bash
> IFS= read -r -p 'Target auth mode: ' target_mode
> IFS= read -r -p 'Exact issuer: ' target_issuer
> IFS= read -r -p 'Stable subject: ' target_subject
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode "$target_mode" \
>   --issuer "$target_issuer" --subject "$target_subject" --yes
> ```
>
> **암호 인증으로 전환할 때**는 암호를 숨김 입력란에 입력합니다.
>
> ```bash
> password_file=$(mktemp)
> chmod 0600 "$password_file"
> read -r -s -p 'Initial password: ' owner_password
> printf '%s' "$owner_password" > "$password_file"
> unset owner_password
> sudo env \
>   DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3 \
>   API_KEY_PEPPER_ID=v1 \
>   API_KEY_PEPPER_FILE=/etc/latex-renderer/secrets/api-key-pepper \
>   AUTH_PASSWORD_PEPPER_FILE=/etc/latex-renderer/secrets/auth-password-pepper \
>   /usr/local/bin/node "$admin_local" auth provision-owner \
>   --owner-id "$owner_id" --auth-mode password --login-name owner \
>   --password-file "$password_file" --yes
> shred -u "$password_file"
> ```
