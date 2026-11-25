---
slug: backups
category: 자체 호스팅
title: 백업 생성, 검증 및 복구
description: 정기 백업과 업데이트 복구 지점을 구분하고 백업을 검증한 뒤 데이터를 복구합니다.
navOrder: 69
updated: "2026-11-22"
since: "v1.3.6"
---

## 백업에 포함되는 내용 {#何が保存されるか}

| 종류 | 포함 항목 | 용도 |
| --- | --- | --- |
| **정기 백업** | SQLite 데이터베이스와 유효한 버전·초안·처리 중인 미리 보기가 참조하는 입력 ZIP | DB, 저장된 프로젝트, 편집 중인 문서 보호 |
| **업데이트 복구 지점** | 업데이트 직전의 SQLite, 애플리케이션 저장소 전체, 업데이트 전 버전 정보 | 업데이트 실패 조사 및 이전 상태 복구 |
| **별도의 호스트 설정 백업** | `/etc/latex-renderer/` 등의 구성 파일, 개인 키, TLS 인증서, Akebi 상태 등 | 서버 장애 후 호스트 재구축 |

- 정기 백업에서 복구한 뒤 프로젝트를 편집기에서 열어 미리 보기를 다시 생성합니다. 임시 작업의 결과 파일과 작업 캐시는 정기 백업 대상에서 제외됩니다.
- 호스트 설정, 인증서, 백업 복호화 키(age identity)는 별도로 보관합니다. **암호화 백업과 복호화 키를 다른 안전한 장소에 보관하여 한 번의 장애로 둘 다 잃지 않도록 하세요.**

## 수동 백업 만들기 {#手動で作成する}

1. 소유자로 로그인하여 **관리 → 시스템 → 백업**을 엽니다.
2. **백업 생성**을 누르고 완료될 때까지 기다립니다.
3. **최신 백업 검증**을 눌러 마지막 검증에 파일명과 검증 시각이 표시되는지 확인합니다. 검증하려면 서버에 복호화 키가 있어야 합니다.

### 명령줄에서 생성 및 검증 {#コマンドで作成-検証する}

1. 서버에서 암호화 백업을 즉시 생성합니다. `/etc/latex-renderer/backup.env`의 `BACKUP_DIRECTORY`가 저장 경로이며 기본값은 `/var/lib/latex-renderer/backups`입니다. 정기 실행은 `latex-renderer-backup.timer`가 담당합니다.

```bash
sudo systemctl start latex-renderer-backup.service
sudo journalctl -u latex-renderer-backup.service -n 20 --no-pager
```

2. 생성한 `.tar.age` 아카이브를 검증용 Linux 호스트로 복사합니다. GNU `tar`, `age`, `node:sqlite`를 사용할 수 있는 Node.js 24 또는 26, 복호화 키를 준비합니다. 장기 보관 시 아카이브와 키를 따로 보관합니다.
3. [수동 다운로드 및 검증 절차](/ko/docs/self-hosting/#v1-6-9をダウンロードして検証)로 백업을 만든 애플리케이션 버전에 맞는 서버 배포본을 받아 압축을 풉니다. 첫 줄의 `version=`에 해당 버전을 지정합니다. `release_dir`에 압축을 푼 디렉터리를 지정하고 배포본의 스크립트를 실행합니다.

```bash
release_dir=/path/to/verified-release
BACKUP_AGE_IDENTITY_FILE=/path/to/age-identity \
  node "$release_dir/deploy/scripts/restore-test.mjs" /path/to/backup.tar.age
```

`restore_test.completed`가 표시되면 검증이 끝난 것입니다. 테스트는 임시 공간에 푼 SQLite와 입력 ZIP의 무결성을 검사합니다. 외부 저장소에 보관한 백업도 그 위치에서 꺼내 검증할 수 있습니다.

## 업데이트 실패 후 복구 지점 확인 {#更新失敗後の復旧点を確認する}

애플리케이션 업데이트에 실패한 뒤 `RECOVERY_REVIEW_REQUIRED`가 표시되면 관리자 권한으로 복구 지점 상태를 확인합니다.

```sh
sudo n624-latex server recovery status
```

> [!DETAILS] 履歴資料　이전 버전에서 상태 확인
>
> `n624-latex server recovery status`를 지원하지 않는 버전에서는 `sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs status`를 실행합니다.

1. 복구 지점 ID(`POINT_ID`), 애플리케이션과 업데이터 버전, DB 스키마, 실행 중인 서비스를 대조합니다. 데이터 복구가 필요하다면 먼저 아카이브와 현재 설정을 별도 위치에 보존합니다.
2. 조사를 마치고 데이터 복원이 필요 없으며 이 복구 지점의 보호를 해제해도 된다고 판단한 경우에만 `acknowledge`를 실행합니다.

```sh
sudo /usr/local/bin/node /usr/local/libexec/latex-renderer-update-recovery.mjs acknowledge POINT_ID
```

`acknowledge`는 복구 검토를 종료하고 조건이 맞으면 서비스를 재개합니다. 데이터를 되돌려야 한다면 복구 지점을 보호한 채 다음 절차를 따릅니다.

## 데이터 복구 {#データを復旧する場合}

백업 이후의 변경 사항은 사라집니다. DB가 호환되고 애플리케이션만 되돌리면 충분한 경우 [업데이트 화면의 롤백](/ko/docs/updates/#前の版へ戻す)을 사용합니다. 데이터를 되돌리려면 먼저 검증용 호스트에서 연습하세요.

1. **대상 확인과 현 상태 보존.** 복구할 백업과 해당 DB 스키마에 맞는 애플리케이션 버전을 확인합니다. 운영 작업 전에 현재 DB, 저장소, 설정도 별도 위치에 보관합니다.
2. **서비스 중지.** 업데이트와 정기 정리를 피하기 위해 공유 관리 잠금을 확보한 상태에서 DB나 저장소에 쓰는 모든 서비스 및 타이머를 중지합니다.
3. **압축 해제와 검증.** 비어 있는 비공개 작업 디렉터리에 아카이브를 복호화하고 풀어 무결성을 검사합니다. 업데이트 복구 지점을 쓰는 경우 root가 관리하는 `summary.json`과 내부 매니페스트도 대조합니다.
4. **동일 시점으로 복구.** SQLite와 입력·결과 저장소를 반드시 **같은 복구 시점**에 맞춰 배치합니다. 정기 백업에서는 복구한 DB가 지정하는 검증된 `storage_key`에 해당 입력 ZIP을 둡니다. 애플리케이션 버전, 설정 파일, 소유권, 권한도 맞춥니다.
5. **시작과 확인.** 서비스를 시작해 로그인, 저장 프로젝트 재변환, 결과 다운로드, 새 백업 실행을 점검합니다. 감사 로그 출력 위치가 맞지 않아 내보내기가 중단됐다면 [감사 로그 복구](/ko/docs/reference/#監査ログの復旧)를 따르세요.

자세한 내용은 [운영 백업 형식과 검사 조건](https://github.com/n624-dev/latex-renderer/blob/main/OPERATIONS.md#backup-and-restore-boundaries), [업데이트 복구 지점 설계](https://github.com/n624-dev/latex-renderer/blob/main/docs/update-recovery.md)를 참고하세요.
