---
slug: lan-https
category: 자체 호스팅
title: LAN에서 HTTPS 사용하기(Akebi)
description: 서버의 LAN IP 주소에서 생성한 HTTPS URL로 연결합니다.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## LAN 주소로 연결 {#lan-の-ip-アドレスからアクセスする}

Akebi는 서버의 사설 IP 주소를 호스트 이름으로 변환하여 HTTPS로 접속할 수 있게 합니다.

공용 인증서 서비스를 사용할 때는 LaTeX Renderer 설정 마법사에서 구성합니다. 직접 인증서 서비스를 제공하려면 [Akebi 서비스 운영 안내](/ko/docs/lan-https-authority/)를 따르세요.

- **IPv4 예제.** 서버 IP가 `192.168.1.50`이고 LAN 도메인이 `lan.example.org`라면 URL은 `https://192-168-1-50.lan.example.org`입니다.
- **IPv6.** 지원되는 사설 주소의 여덟 그룹을 모두 펼쳐 호스트 이름을 만듭니다. 실제 접속에는 설정 화면에 표시된 URL을 그대로 사용하세요.

**네트워크 및 DNS 요건**
클라이언트 기기에서 서버의 LAN에 접근할 수 있어야 합니다. 이름을 확인할 수 없다면 라우터나 DNS 리졸버의 **DNS 리바인딩 방지** 기능이 사설 IP를 반환하는 응답을 차단하는지 확인합니다. 필요하면 사용하는 LAN 도메인만 예외에 추가하세요.

## 인증서 방식 선택 {#証明書の方式を選ぶ}

| 방식 | 요구 사항 및 동작 |
| --- | --- |
| **공용 서비스 및 공개 CA** | 공용 서비스 설정을 사용하고 CA 약관에 동의합니다. 인증서 개인 키는 서버에 보관됩니다. |
| **자체 서비스 및 공개 CA** | [자체 Akebi 인증서 서비스](/ko/docs/lan-https-authority/)의 URL과 LAN 도메인이 필요합니다. 초대 방식이면 초대 코드도 준비합니다. |
| **Keyless** | Keyless를 지원하는 서비스에 TLS 핸드셰이크 서명을 위임합니다. |
| **기존 인증서 또는 사설 CA** | 서버 이름과 일치하는 인증서 및 개인 키가 필요합니다. 사설 CA 사용 시 서버와 모든 클라이언트에 루트 CA 신뢰를 설정합니다. |

> [!NOTE]
> - 공개 CA를 사용하면 발급된 인증서의 호스트 이름이 공개 **인증서 투명성(CT) 로그**에 기록됩니다.
> - 다른 장소의 LAN이라도 같은 사설 IP와 LAN 도메인을 조합하면 브라우저는 **같은 출처**로 취급하여 쿠키 등 저장 공간을 공유합니다.

## LAN 접속 설정 {#lan-向けに設定する}

1. 새 설치라면 [서버 준비](/ko/docs/self-hosting/#準備するもの) 후 `sudo n624-latex server setup --web`으로 [마법사](/ko/docs/server-setup/#ブラウザで開く)를 시작합니다. 관리 중인 전용 HTTPS 서버를 전환하려면 `sudo n624-latex server setup --ingress --web`를 사용합니다.
2. 공개 경로로 **LAN**을 선택하고 네트워크 인터페이스, 사설 IP, 접속 허용 서브넷, HTTPS 포트를 지정합니다.
3. 인증서 서비스와 방식을 선택합니다. 공용 서비스를 선택하면 서비스 URL은 `https://akebi.n624.net`, LAN 도메인은 `lan.n624.net`로 설정되며 적용 시 자동 등록됩니다. 초대 코드는 필요하지 않습니다. 공개 CA는 약관을 확인하고 동의합니다. 초대 방식의 자체 서비스는 관리자에게 받은 코드를 입력합니다.
4. 미리 보기에 표시된 HTTPS URL과 허용 서브넷을 확인하고 적용합니다. 앱의 암호 및 OIDC 인증은 계속 적용됩니다.
5. 허용된 서브넷의 다른 기기에서 HTTPS URL을 열어 인증서 경고 없이 로그인하고 예제 문서를 변환할 수 있는지 확인합니다.

인증서 서비스를 직접 구축하려면 [Akebi 인증서 서비스 운영](/ko/docs/lan-https-authority/)을 참고하세요.

## 인증서 상태 확인 {#証明書の状態を確認する}

서비스 상태, 자동 갱신 타이머, 전용 네임스페이스 로그는 다음 명령으로 확인합니다.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

발급이나 갱신에 실패하면 서버 시계, 인증서 서비스와의 HTTPS 연결, 도메인과 IP 설정, CA가 반환한 재시도 가능 시각을 확인합니다. 일시적 갱신 실패 시 기존 유효 인증서를 유지하고 다음 타이머 실행 때 기록된 발급 절차를 재개합니다. 개인 키와 발급 상태가 일치하지 않으면 같은 세대의 보관된 상태 파일을 확인하세요.

[Akebi 설계 및 상세 장애 대응](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md)을 참고하세요.
