---
slug: lan-https-authority
category: 자체 호스팅
title: Akebi 인증서 서비스 직접 운영하기
description: LAN 도메인의 DNS 위임, 인증서 발급, 초대 또는 자동 등록을 설정합니다.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

자체 인증서 서비스를 운영할 관리자를 위한 안내입니다. 공용 서비스를 사용해 LAN에 LaTeX Renderer를 제공하려면 [LAN에서 HTTPS 사용하기](/ko/docs/lan-https/)를 참고하세요.

위임할 수 있는 DNS 영역, 공개 DNS와 HTTPS를 제공할 수 있는 Linux 호스트(amd64 또는 arm64), 지원되는 Node.js(24 또는 26), 사용할 CA 계정을 준비합니다. [수동 다운로드 절차](/ko/docs/self-hosting/#v1-6-9をダウンロードして検証)로 서명을 검증한 서버 배포본을 사용하세요.

## DNS 위임 {#dns-を委任する}

상위 도메인의 DNS 영역에 다음 레코드를 설정합니다. 인터넷에서 **UDP와 TCP 모두 53번 포트**로 Akebi DNS 서버에 접근할 수 있어야 합니다.

| 유형 | 이름 | 값 |
| --- | --- | --- |
| `A` | `ns1.example.org` | Akebi DNS 서버의 공인 IPv4 주소 |
| `A` | `akebi.example.org` | Akebi API용 HTTPS 리버스 프록시의 공인 IPv4 주소 |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- `ns1.example.org`는 DNS 전용으로 두고, API 호스트 이름(`akebi.example.org`)은 LAN 인증서의 대상 영역(`lan.example.org`) 밖에 둡니다.
- 위임 후 Akebi가 LAN IP 기반 `A` 및 `AAAA` 응답과 ACME 검증용 `TXT` 응답을 동적으로 반환하므로 상위 영역에 IP별 레코드를 추가할 필요가 없습니다.

## 서비스 배포 {#サービスを配置する}

1. **전용 사용자와 상태 디렉터리 생성.** 애플리케이션과 권한을 분리해 전용 사용자 및 그룹 `latex-renderer-lan-authority`를 만듭니다. 해당 소유권으로 `/var/lib/latex-renderer-lan-authority`와 그 아래 `keyless` 디렉터리를 만들고 둘 다 모드 `0700`으로 설정합니다.
2. **설정 디렉터리 준비.** `/etc/latex-renderer-lan-authority`의 소유권을 `root:latex-renderer-lan-authority`, 모드를 `0750`으로 설정합니다. 검증된 배포본의 `deploy/lan-https/examples/authority.json`을 복사해 소유권을 `root:latex-renderer-lan-authority`, 모드를 `0640`으로 설정합니다.
3. **`authority.json` 편집**
   - `policy.serverOrigin`는 API의 HTTPS URL입니다(예: `https://akebi.example.org`).
   - `policy.lanDomain`은 위임한 LAN 도메인입니다(예: `lan.example.org`).
   - `dns.nameserver`와 `dns.listeners`에는 공개 DNS 호스트 이름과 수신 주소를 지정합니다. 기존 DNS가 53번 포트를 쓰면 충돌하지 않는 공인 IP를 선택합니다.
   - `http`는 루프백 주소에 바인딩합니다.
   - `issuers`에는 사용할 공개 CA를 지정합니다. EAB(External Account Binding)가 필요하면 지정한 `eabFile`을 전용 사용자가 소유하도록 하고 모드를 `0600`으로 설정한 뒤 `kid`와 `hmacKey`를 저장합니다. 도메인에서 CAA를 사용하면 해당 CA를 허용하세요.
4. **코드 및 systemd 유닛 배치.** 다음은 root 소유의 검증된 소스가 `/path/to/verified-release`에 있는 예입니다.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **상태 초기화 및 서비스 시작.** `init`는 최초 한 번만 실행합니다.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## HTTPS 인증서 준비 {#https-証明書を用意する}

API 공개용 Nginx 설정 예제는 `deploy/lan-https/examples/authority.nginx.conf`에 있으며 루프백 API로 전달합니다. Nginx의 TLS 설정을 활성화하기 전에 API 자체 인증서를 발급받습니다.

Certbot 자동 갱신을 사용하려면 CA, 연락처, 약관 동의 및 필요한 EAB 정보를 root 전용 `/etc/latex-renderer-lan-authority/certbot.ini`에 기록합니다. 키는 ECDSA P-256을 사용합니다. DNS 위임이 반영된 뒤 다음을 실행합니다.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

발급 후 Nginx의 서버 이름 및 인증서 경로를 맞추고 `nginx -t`로 구문을 확인한 뒤 적용합니다. Certbot 갱신 타이머도 확인합니다.

- **Keyless 제공 시** API 인증서와 별도로 `*.lan.example.org`만 포함하는 ECDSA P-256 와일드카드 인증서를 발급합니다. 위 명령에서 `--cert-name`을 `akebi-keyless`로, `-d`를 `'*.lan.example.org'`로, `--deploy-hook`을 `"$hooks/operator-certificate-hook.sh"`으로 바꿔 실행합니다. 공개 CA 방식만 제공한다면 필요하지 않습니다.

## 등록 방식 설정 {#登録方法を設定する}

`authority.json`의 `policy.registration`에서 클라이언트 서버 등록 방식을 선택합니다.

- `"open"`은 자동 등록을 허용합니다.
- `"invite"`는 관리자가 발행한 초대 코드를 요구합니다.

초대 방식이면 아래 명령으로 사용 횟수와 유효 기간이 제한된 코드를 발급하고 대상자에게만 안전한 경로로 전달합니다.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

두 등록 방식 모두 등록 수, 발급 빈도, 보관 수에 대한 제한과 CA 발급 정책을 따릅니다.

## 외부에서 검증 {#外部から確認する}

외부 기기에서 DNS 위임, UDP와 TCP 양쪽의 SOA 응답, IP 기반 호스트 이름 확인 및 HTTPS 검색 응답을 점검합니다.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

모두 응답하면 테스트용 LaTeX Renderer 서버에서 [LAN 접속 설정](/ko/docs/lan-https/#lan-向けに設定する) 절차로 연결해 인증서 발급과 로그인을 확인합니다. CA가 속도 제한 등으로 대기 시각을 반환하면 그때까지 재시도하지 마세요.

**백업.** 암호화 백업에는 `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, CA 계정과 Certbot 갱신 설정을 포함합니다. 실행 중인 SQLite는 온라인 백업 기능을 사용하세요.

[Akebi 설정 예제 및 구현 규격](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md)을 참고하세요.
