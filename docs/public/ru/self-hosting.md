---
slug: self-hosting
category: Самостоятельное размещение
title: Эксплуатация LaTeX Renderer на своём сервере
description: Выберите поддерживаемую конфигурацию, подготовьте хост и установите сервис с обновлениями и резервным копированием.
navOrder: 63
updated: "2026-11-22"
since: "v1.2.0"
---

## Варианты установки {#現在の提供状況}

Чтобы развернуть сервер, установите [пакет APT](/ru/docs/client/#debian-ubuntu-の-apt-パッケージ) и запустите мастер. Он настроит HTTPS, способ входа и первого владельца.

### Порядок первоначальной установки {#初回導入の順序}

1. **Подготовьте сервер.** Проверьте [поддерживаемые системы и способы доступа](#対応する構成) и [установите Docker Engine и Nginx](#準備するもの).
2. **Установите пакет APT.** По [инструкции для Debian и Ubuntu](/ru/docs/client/#debian-ubuntu-の-apt-パッケージ) установите `n624-latex`.
3. **Настройте сервер.** Из непривилегированной учётной записи развёртывания выполните `sudo n624-latex server setup --plan`. Устраните недостающие зависимости и продолжите [настройку в браузере](/ru/docs/server-setup/#ブラウザで開く).
4. **Создайте первый PDF.** Откройте настроенный HTTPS-адрес, [войдите и преобразуйте тестовый документ](#導入完了の確認). Мастер подготовит первую среду TeX.

Для существующего сервера см. [Обновление из раздела администрирования](/ru/docs/updates/). Для установки из tar-архива см. [Ручная установка](#v1-6-9をダウンロードして検証).

## Автоматический HTTPS в локальной сети {#lan-内の自動-https}

С помощью **Akebi** можно настроить HTTPS-адрес на основе частного IP сервера. Для начала подойдёт общий сервис сертификатов. См. [HTTPS в локальной сети с Akebi](/ru/docs/lan-https/).

## Поддерживаемые конфигурации {#対応する構成}

С помощью APT можно выполнить новую установку на одном хосте с `systemd` под Debian 12 или 13 либо Ubuntu 24.04 или 26.04 на amd64 или arm64. Документы LaTeX компилируются в Docker без root от отдельного пользователя.

| Режим развёртывания (`DEPLOYMENT_MODE`) | Входной узел | Способы входа |
| --- | --- | --- |
| `standalone` | Nginx, Caddy, Apache или HTTPS в локальной сети (Akebi) | Локальные пароли, OIDC или оба варианта |
| `cloudflare` | Cloudflare Tunnel и Worker | Cloudflare Access или встроенная аутентификация (пароли, OIDC или оба варианта) |

- **OIDC.** Позволяет использовать поставщика удостоверений (IdP) организации.
- **Cloudflare Access.** Подготовьте в Cloudflare приложение Access для пользователей.
- **Локальные пароли.** Регистрируйте пользователей через администрирование сервера без внешнего IdP.
- **Пароли и OIDC.** Включите оба способа во встроенной аутентификации с помощью `AUTH_BACKEND=native`, `AUTH_PASSWORD_ENABLED=true` и `AUTH_OIDC_ENABLED=true`. Для прежних конфигураций с одним способом используется `AUTH_MODE`.

## Подготовка сервера {#準備するもの}

- **Рабочая учётная запись.** Подключитесь от обычного пользователя и запускайте команды настройки с `sudo`.
- **Диск.** Предварительная проверка требует **не менее 5 ГиБ свободного места** на каждой файловой системе, содержащей `/opt` или `/var/lib`. Предусмотрите дополнительное место под образы TeX, версии, результаты и зашифрованные копии.
- **Docker Engine.** Установите Docker Engine и `docker-ce-rootless-extras` из официального репозитория. Мастер настроит Docker без root для компиляции. См. официальные инструкции для [Debian](https://docs.docker.com/engine/install/debian/) или [Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
- **Nginx.** Установите его с помощью `sudo apt install nginx`. При новой установке через APT проверяется наличие Nginx, даже если внешний доступ обеспечивает Caddy, Apache или Cloudflare.
- **Доступ и TLS.** Для собственного HTTPS подготовьте имя хоста, сертификат и закрытый ключ. Освободите адрес и порт для встроенного HTTPS. Для Cloudflare подготовьте Tunnel, DNS и Worker. См. [Требования для HTTPS в локальной сети](#lan-内の自動-https).
- **Учётные данные**
  - Для OIDC нужны URL эмитента, идентификатор и секрет клиента, а также стабильный `subject` первого владельца.
  - Для Cloudflare Access нужны сведения о приложении Access и `subject` владельца.
  - Для входа по паролю подготовьте имя пользователя и начальный пароль владельца.
- **Исходящие соединения.** Серверу нужен HTTPS-доступ к GitHub Releases и Attestations, GHCR (`ghcr.io`), архивам TeX Live и репозиториям пакетов Debian или Ubuntu.
- **Пакет APT.** Включает Node.js. См. [Инструкции для APT](/ru/docs/client/#debian-ubuntu-の-apt-パッケージ).

## Проверка установки {#導入完了の確認}

1. Откройте `/admin/` по настроенному HTTPS-адресу и войдите как владелец, зарегистрированный при установке.
2. Откройте `/app/` по тому же адресу, выберите [пример `main.tex`](/ru/docs/#最短でpdfを作る) и нажмите **Преобразовать в PDF**.
3. Откройте PDF на странице результатов и проверьте, что в нём отображается текст примера.

> [!DETAILS] Дополнительные проверки служб и выходных данных
>
> Администраторы могут проверить преобразование через публичный URL. Выданный для проверки ключ API отзывается сразу после неё.
>
> ```bash
> sudo sh /opt/latex-renderer/current/deploy/scripts/smoke-test-production.sh
> ```
>
> Проверьте также вход обычного пользователя, публичные руководства, языки и образ в среде TeX и типичные выходные данные, например документы на японском или SVG.

### Регистрация пользователей и выдача ключей {#利用者と-api-キーの発行}

После успешного входа в `/admin/` в качестве владельца зарегистрируйте пользователей.

- **Веб-приложение и Remote MCP.** Создайте пользователя в разделе **Пользователи**, укажите идентификатор для выбранного способа входа и передайте пользователю URL веб-приложения.
- **CLI, Local MCP и HTTP API.** Создайте связанную с пользователем сервисную учётную запись. В разделе **Ключи API → Выдать ключ API** создайте ключ рендеринга с правами `render:create` и `render:read:own` (префикс `lrk_...`) и передайте по защищённому каналу.

## Обновления и откат {#更新とロールバック}

### Обновление приложения {#アプリケーションを更新する}

- Как владелец откройте **Администрирование → Обновления**. См. [Обновление сервера и возврат к предыдущей версии](/ru/docs/updates/).
- Для смены версии или языков TeX Live откройте **Администрирование → Среда TeX**. См. [Настройка среды TeX](#tex環境の初期設定).

> [!DETAILS] 履歴資料　Особые случаи миграции и восстановления
>
> ### Переход с программы обновления v1.2.x под root на разделение привилегий {#v1-2-xのroot-updaterから権限分離updaterへ移行する場合}
>
> См. [Инструкции по миграции программы обновления](/ru/docs/reference/#v1-2-xのroot-updaterから権限分離updaterへ移行する場合).
>
> ### GNU tar прерывает распаковку с сообщением Function not implemented {#gnu-tarの展開がfunction-not-implementedで停止する場合}
>
> См. [Порядок действий при ошибке распаковки](/ru/docs/reference/#gnu-tarの展開がfunction-not-implementedで停止する場合).
>
> ### Блокировка изменений уже занята {#mutation-lockが使用中と表示される場合}
>
> См. [Определение процесса, удерживающего блокировку](/ru/docs/reference/#mutation-lockが使用中と表示される場合).

## Резервные копии {#バックアップ}

Периодические копии, точки перед обновлениями, проверка восстановления и восстановление данных описаны в разделе [Создание, проверка и восстановление резервных копий](/ru/docs/backups/). Если после восстановления не совпадает позиция экспорта аудита, см. [Восстановление журналов аудита](/ru/docs/reference/#監査ログの復旧).

## Устранение неполадок {#問題が起きた場合}

| Симптом | Что проверить сначала |
| --- | --- |
| Не удаётся открыть `/app/` | DNS, сертификат TLS, настройки Tunnel или прокси и порядок запуска локальных служб |
| Не могут войти только администраторы | Явно заданные идентификатор или учётные данные владельца, `AUTH_MODE`, эмитент, аудитория и роли |
| Не удаётся получить образ TeX | HTTPS-доступ к `ghcr.io`, видимость пакета и архитектура тега |
| Изменение TeX занимает много времени | Идентификатор операции и журналы Image Manager с удалёнными конфиденциальными данными |
| Обновление отклонено | Неизменяемость выпуска, дайджест архива, путь обновления и свободное место |
| Подготовка хоста прервалась из-за небезопасного пути | Проверьте, что `/var/lib/latex-renderer` принадлежит `root:latex-renderer` и имеет режим `2770` |
| Не работает только страница обновлений | Наличие `client-dist/manifest.json` в дистрибутиве и состояние Admin Web |
| Преобразование не начинается | Состояние очереди, не менее 5 ГиБ свободного места, служба обработчика и сокет Docker без root |
| Проблемы возникли сразу после обновления | Закройте приём новых заданий и сравните прежние и новые версии приложения и среды, прежде чем принимать решение об откате |

Запишите идентификатор операции, этап сбоя и код ошибки, которым можно поделиться. См. [Устранение неполадок](/ru/docs/troubleshooting/), [Безопасность учётных записей и документов](/ru/docs/security/) и [Настройка развёртывания и конфигурационные файлы (DEPLOYMENT.md)](https://github.com/n624-dev/latex-renderer/blob/main/DEPLOYMENT.md).

## Изменение среды TeX {#tex環境の初期設定}

Первоначальная настройка готовит среду компиляции. Для добавления языков или смены версии TeX Live откройте **Администрирование → Среда TeX** (`/admin/tex-environment/`). Следующий пример поддерживает английский и японский языки.

| Параметр | Рекомендуемое значение |
| --- | --- |
| Image | `latest` (для тега с фиксированной датой выберите подходящую архитектуру) |
| Languages | `collection-langenglish`, `collection-langjapanese` |
| Automatic image update | On |
| Base local build fallback | Off (отключено по умолчанию) |

- Из публичного пакета GHCR загружается только **базовый образ** без языков, зафиксированный по дайджесту. Сервер собирает **образ среды выполнения** с выбранными языками и текущим кодом рендерера. Если локально есть образ с той же конфигурацией, он используется повторно. Образы среды выполнения не публикуются вовне.
- Сборка продолжается после закрытия браузера. Затем проверьте активную среду и языки в администрировании. При ошибке скачивания проверьте HTTPS-доступ к `ghcr.io` и совместимость архитектуры.

### Автоматическая очистка диска {#自動容量整理}

> [!DETAILS] Удаление неиспользуемых образов и кеша сборки
>
> По умолчанию Image Manager каждые 24 часа очищает неиспользуемые управляемые образы. Защищены текущие базовый образ и среда выполнения, предыдущие версии для отката, а также образы, указанные в конфигурации. Остальные можно удалить через 24 часа после создания. Для неиспользуемого кеша сборки применяется ориентир в 2 ГиБ без ограничения всего Docker.
>
> Задайте значения в `/etc/latex-renderer/renderer.env` и примените их командой `sudo systemctl restart latex-renderer-image-manager.service`, пока не выполняется обновление TeX.
>
> ```dotenv
> IMAGE_CLEANUP_INTERVAL_HOURS=24
> IMAGE_CLEANUP_RETENTION_HOURS=24
> IMAGE_BUILD_CACHE_MAX_GIB=2
> ```
>
> - `INTERVAL_HOURS` принимает `0` для отключения очистки или интервал от `1` до `720` часов. Начиная через 5 минут после запуска, каждые 5 минут проверяется, пора ли выполнять очистку. Общая блокировка откладывает очистку во время обновлений и развёртываний. Ручная очистка через веб-интерфейс или CLI удаляет незащищённые объекты без ожидания окончания срока хранения.
> - Для `RETENTION_HOURS` допустимо от `0` до `8760` часов, для `BUILD_CACHE_MAX_GIB` — от `0` до `1024` ГиБ.
> - Начиная с `1.3.4-rc.2` метаданные Buildx для Docker без root изолируются в `.docker/buildx-worker` в домашнем каталоге обработчика во избежание конфликтов прав со сборками root. Автоочистка пропускает образы старых конфигураций и каталоги ручного восстановления. Удаляйте отдельные элементы только после проверки, что они больше не нужны. Никогда не удаляйте напрямую каталог данных Docker.

## Привилегии при установке и эксплуатации {#sudoと通常運用の境界}

При первоначальной установке создаются системные пользователи, каталоги, модули `systemd`, Docker без root и файлы ключей с помощью `sudo`. **В обычном режиме веб-приложению и API администрирования не предоставляются права `sudo`.**

- **Изменения TeX.** Запросы передаются принадлежащему root диспетчеру Image Manager через сокет Unix с ограниченными правами.
- **Обновления.** Через сокет Unix вызывается непривилегированный контроллер Update Manager, который делегирует фиксированные операции краткоживущему вспомогательному процессу root.
- **Взаимное исключение.** Общая блокировка упорядочивает изменения TeX и обновления. Веб-приложение и API не могут передавать root произвольные команды, пути или URL.

## Конфигурация и секреты {#設定と秘密情報}

Индивидуальные параметры хоста и секреты хранятся вне приложения и рабочего дерева Git, например в `/etc/latex-renderer/`.

| Путь | Содержимое | Рекомендуемый режим |
| --- | --- | --- |
| `/etc/latex-renderer/renderer.env` | Профиль доступа, URL, лимиты и несекретные параметры IdP | `0640` |
| `/etc/latex-renderer/deployment.env` | Идентификаторы и токены только для профиля Cloudflare | `0600` |
| `/etc/latex-renderer/update-manager.env` | Непривилегированная учётная запись развёртывания | `0600` |
| `/etc/latex-renderer/gateway-worker.wrangler.jsonc` | Привязки и маршруты Worker в рабочей среде | `0600` |
| `/etc/cloudflared/config.yml` | Входные маршруты Cloudflare Tunnel | `0640` |
| `/etc/latex-renderer/secrets/` | Pepper, ключ билетов и учётные данные диспетчеров | Зависит от файла |
| `/etc/latex-renderer/secrets/oidc-client-secret` | Секрет клиента для профиля OIDC | `0440` |

> [!WARNING]
> Не добавляйте в Git и не прикладывайте к обращениям или запросам поддержки `.env`, токены Cloudflare, учётные данные Tunnel, ключи API, базы SQLite, реальные документы, PDF или неотредактированные журналы. Файлы `*.example` в репозитории служат образцами полей.

## Ручная установка из tar-архива и прежние версии {#手動配置-旧版向けの構築手順-tarball-導入}

При использовании APT и `sudo n624-latex server setup` мастер выполняет распаковку, подготовку хоста и регистрацию владельца либо подсказывает нужные действия. Раскройте раздел ниже, если вручную развёртываете `v1.7.1` или хотите проверить границы доступа или смену аутентификации.

> [!DETAILS] Скачивание, проверка, развёртывание и регистрация владельца в v1.7.1
>
> Для новой ручной установки используйте стабильный выпуск [v1.7.1](https://github.com/n624-dev/latex-renderer/releases/tag/v1.7.1) и архив `latex-renderer-server-1.7.1.tar.gz`. Тег и файлы неизменяемы после публикации. Прямое развёртывание из ветки разработки `main` и локальная `docker build` для TeX в рабочей среде не поддерживаются.
>
> ### Скачивание и проверка v1.7.1 {#v1-6-9をダウンロードして検証}
>
> Подготовьте `curl`, `jq`, `tar`, `sha256sum` и GitHub CLI с поддержкой `gh attestation verify`. Node.js и Corepack устанавливаются позже, при подготовке хоста.
>
> От имени обычного пользователя выполните следующий код в одном сеансе Bash. Проверяются SHA-256 из GitHub Releases и подпись происхождения GitHub Actions. Данные о происхождении передаются из публичного API в `gh` без учётной записи или токена GitHub. При сбое шага `bundle_root` остаётся незаданной. Устраните причину и повторите.
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
> ### Подготовка хоста {#ホストを準備}
>
> Установите `setfacl` для прав на хранилище, `bsdtar` для распаковки в ограниченной среде программы обновления и `unzip` для проверки ZIP. По официальным инструкциям установите Node.js 26 или 24 (`/usr/local/bin/node` и `/usr/local/bin/corepack`) и инструменты Docker без root. Для `cloudflare` установите также `cloudflared`. Update Manager через Corepack устанавливает и проверяет закреплённую версию pnpm для пользователя развёртывания.
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
> Из обычной учётной записи развёртывания инициализируйте хост и настройте Docker без root для `latex-render-worker`.
>
> ```bash
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/install-host.sh"
> sudo sh "${bundle_root:?Complete release verification first}/deploy/scripts/configure-rootless-docker.sh"
> ```
>
> ### Создание конфигурации хоста {#ホスト固有設定を作成}
>
> Для всех профилей создайте `renderer.env` и задайте `PUBLIC_ORIGIN`, `DEPLOYMENT_MODE` и `AUTH_MODE`. Псевдоним наподобие `ADMIN_ALLOWED_ORIGINS` не предусмотрен. Разрешённый источник операций браузера должен точно совпадать с `PUBLIC_ORIGIN`.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0640 \
>   "$bundle_root/.env.example" /etc/latex-renderer/renderer.env
> sudoedit /etc/latex-renderer/renderer.env
> ```
>
> - **Профиль `cloudflare`.** Замените `example.com`, `REPLACE_*`, все UUID и аудиторию Access значениями вашей установки. Для удалённо управляемого Tunnel опустите локальный `config.yml` и предварительно проверьте, что коннектор активен.
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
> - **Профиль `standalone`.** Установите Nginx, Caddy или Apache, скопируйте образец из `deploy/reverse-proxy/` и укажите FQDN и пути к сертификатам. Прокси удаляет входящие заголовки `CF-Access-*` и перезаписывает IP клиента. Не открывайте наружу напрямую локальные службы на портах 3100–3105.
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
> - **При `AUTH_MODE=oidc`.** Зарегистрируйте `https://<PUBLIC_ORIGIN-host>/auth/oidc/callback` в IdP. В `renderer.env` задайте `OIDC_ISSUER` и `OIDC_CLIENT_ID` и сохраните секрет в отдельном файле без завершающего перевода строки.
>
> ```bash
> sudo install -o root -g latex-renderer -m 0440 /dev/null \
>   /etc/latex-renderer/secrets/oidc-client-secret
> sudoedit /etc/latex-renderer/secrets/oidc-client-secret
> ```
>
> ### Развёртывание служб {#サービスを配置}
>
> ```bash
> release_id=$(jq -r '"v\(.version)-\(.commit[0:12])"' "${bundle_root:?Complete release verification first}/.latex-renderer-release.json")
> sudo /usr/local/bin/node "${bundle_root:?Complete release verification first}/deploy/scripts/bootstrap-published-host.mjs" "$version"
> ```
>
> - При первом запуске повторно скачивается и проверяется опубликованный неизменяемый архив, разделяются управляющее дерево root и непривилегированное дерево сборки. Затем собирается `client-dist` и развёртывается в `/opt/latex-renderer/releases/$release_id`. Хосты с существующей базой или `current` отклоняются. После установки пользуйтесь обычным обновлением.
> - Перед развёртыванием проверьте `renderer.env` (принадлежит root, режим `0640`, нет повторяющихся ключей), `PUBLIC_ORIGIN`, параметры аутентификации, а также владельцев, права и длину pepper и секретов без вывода их значений.
> - Программа обновления хранится отдельно в `/opt/latex-renderer/updater`, как описано в `docs/independent-updater.md` репозитория. Только основная группа пользователя развёртывания может проходить через `/opt/latex-renderer/update-staging`. Каждый промежуточный каталог изолируется с помощью `0700` и очищается по завершении либо, при прерывании, при следующем запуске по истечении 24 часов.
>
> ### Границы публичного доступа {#公開境界}
>
> - **`cloudflare-access`.** Защитите `/auth/*`, `/app/`, `/admin/` и `/oauth/authorize` одним приложением Access для пользователей и проверяйте аудиторию также на исходном сервере. Для Cloudflare с OIDC или паролем проследите, чтобы Access не блокировал `/auth/*`. Документация и загрузки публичны. Worker Routes обслуживают только публичную часть API рендеринга. Во входных правилах Tunnel сначала укажите конкретные пути API и администрирования, затем веб-приложение по умолчанию и в конце `http_status:404`.
> - **`standalone`.** Обратный TLS-прокси направляет запросы к локальным службам по пути. На Standalone Gateway с портом 3105 направляются только небольшие JSON-операции с билетами. Пример Nginx ограничивает соединения и частоту запросов входа по паролю и API билетов. В Caddy и Apache без расширений нет эквивалентного ограничения на клиента, поэтому оно обязательно на балансировщике или у провайдера. Не открывайте наружу `/internal/*`, базу данных и сокеты управления.
>
> ### Первый владелец {#最初のowner}
>
> Внешняя идентичность определяется по `provider + issuer + subject`, а при входе по паролю — по `login name`. Электронная почта используется только для отображения. Учётные записи не связываются по совпадению адресов и не создаются автоматически при входе. Один раз выполните процедуру для выбранного способа.
>
> **Cloudflare Access или OIDC**
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
> **Локальный пароль (пример имени `owner`)**
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
> ### Последующее изменение AUTH_MODE {#後からauth-modeを変更する場合}
>
> Используйте эту процедуру, если [мастер сервера](/ru/docs/server-setup/) недоступен.
> Создайте зашифрованную копию и остановите API администрирования. С неизменяемым идентификатором из панели управления или `users list` (формат `user_...`) добавьте новый метод аутентификации. Перезапись существующих учётных данных отклоняется, действующие сеансы отзываются. Затем измените `renderer.env` и перезапустите API и веб-приложение. Сохраняйте прежние учётные данные до проверки нового входа в приватном окне.
>
> Сначала выполните подготовку ниже, а затем лишь команды для выбранного метода.
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
> **Чтобы перейти на OIDC или Cloudflare Access**, введите `oidc` или `cloudflare-access`.
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
> **Чтобы перейти на пароль**, введите его в скрытом поле.
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
