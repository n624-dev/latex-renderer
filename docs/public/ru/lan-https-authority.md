---
slug: lan-https-authority
category: Самостоятельное размещение
title: Эксплуатация сервиса сертификатов Akebi
description: Настройте делегирование DNS для домена локальной сети, выпуск сертификатов и регистрацию — открытую или по приглашениям.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Руководство предназначено для администраторов собственного сервиса сертификатов. Для использования общего сервиса с LaTeX Renderer см. [HTTPS в локальной сети с Akebi](/ru/docs/lan-https/).

Потребуются DNS-зона, которую можно делегировать, хост Linux (amd64 или arm64) для публичных DNS и HTTPS, Node.js 24 или 26 и учётная запись в удостоверяющем центре (УЦ). Используйте серверный дистрибутив, подпись которого проверена по [инструкции по ручному скачиванию](/ru/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Делегирование DNS {#dns-を委任する}

Настройте эти записи в родительской зоне. DNS Akebi должен быть доступен из интернета **на порту 53 как по UDP, так и по TCP**.

| Тип | Имя | Значение |
| --- | --- | --- |
| `A` | `ns1.example.org` | Публичный IPv4 DNS-сервера Akebi |
| `A` | `akebi.example.org` | Публичный IPv4 обратного HTTPS-прокси API Akebi |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Выделите `ns1.example.org` для DNS и разместите хост API (`akebi.example.org`) за пределами зоны сертификатов локальной сети (`lan.example.org`).
- После делегирования Akebi динамически возвращает записи `A` и `AAAA` для имён, сформированных из локальных IP, и `TXT` для проверок ACME. В родительской зоне не требуются отдельные записи на каждый IP.

## Развёртывание сервиса {#サービスを配置する}

1. **Создайте пользователя и каталоги состояния.** Изолируйте права приложения с помощью отдельных пользователя и группы с именем `latex-renderer-lan-authority`. Создайте `/var/lib/latex-renderer-lan-authority` и его подкаталог `keyless` с этим владельцем и режимом `0700` для обоих.
2. **Подготовьте каталог конфигурации.** Создайте `/etc/latex-renderer-lan-authority` с владельцем и группой `root:latex-renderer-lan-authority` и режимом `0750`. Скопируйте туда `deploy/lan-https/examples/authority.json` из проверенного дистрибутива и задайте `root:latex-renderer-lan-authority` и режим `0640`.
3. **Отредактируйте `authority.json`.**
   - `policy.serverOrigin` задаёт HTTPS-адрес API, например `https://akebi.example.org`.
   - `policy.lanDomain` задаёт делегированный домен локальной сети, например `lan.example.org`.
   - `dns.nameserver` и `dns.listeners` задают публичный DNS-хост и адреса прослушивания. Если другой DNS уже занимает порт 53, выберите свободный публичный IP.
   - Привяжите `http` к интерфейсу обратной петли.
   - Укажите публичный УЦ в `issuers`. Если он требует External Account Binding (EAB), используйте указанный `eabFile`, принадлежащий пользователю службы и имеющий режим `0600`, для хранения `kid` и `hmacKey`. Если в домене есть записи CAA, разрешите выбранный УЦ.
4. **Установите код и модуль systemd.** В примере проверенные исходники принадлежат root и расположены в `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Инициализируйте состояние и запустите службу.** Выполните `init` только при первом запуске.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Получение сертификата HTTPS {#https-証明書を用意する}

Образец Nginx для публикации API находится в `deploy/lan-https/examples/authority.nginx.conf` и передаёт запросы к API на локальном интерфейсе. Получите сертификат API до включения TLS в Nginx.

При автоматическом продлении с Certbot укажите УЦ, контакт, принятие условий и необходимые данные EAB в `/etc/latex-renderer-lan-authority/certbot.ini`, доступном только root. Используйте ключ ECDSA P-256. Дождитесь распространения делегирования DNS и выполните команды.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

После выпуска укажите имя сервера и пути к сертификатам в Nginx, проверьте синтаксис с помощью `nginx -t`, примените изменения и проверьте таймер продления Certbot.

- **Для поддержки Keyless** получите отдельный подстановочный сертификат ECDSA P-256, в котором указано только `*.lan.example.org`. В команде выше замените `--cert-name` на `akebi-keyless`, `-d` на `'*.lan.example.org'` и `--deploy-hook` на `"$hooks/operator-certificate-hook.sh"`. Если доступен только режим публичного УЦ, такой сертификат не требуется.

## Настройка регистрации {#登録方法を設定する}

В `authority.json` выберите с помощью `policy.registration` способ регистрации клиентских серверов.

- `"open"` разрешает автоматическую регистрацию.
- `"invite"` требует выданного администратором кода.

Для регистрации по приглашению создайте командой ниже код с ограничениями по числу использований и сроку действия. Передайте его только адресату по защищённому каналу.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

В обоих режимах действуют лимиты регистрации, частоты выпуска и количества хранимых элементов, а также правила выпуска УЦ.

## Проверка извне {#外部から確認する}

С внешнего узла проверьте делегирование DNS, ответы SOA по UDP и TCP, разрешение имён, сформированных из IP, и ответ обнаружения по HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

После успешных проверок подключите тестовый сервер LaTeX Renderer по инструкции [Настройка доступа из локальной сети](/ru/docs/lan-https/#lan-向けに設定する) и убедитесь, что сертификат выпускается, а вход работает. Если УЦ указал время следующей попытки, дождитесь его.

**Резервные копии.** Включите `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, учётные записи УЦ и конфигурацию продления Certbot в зашифрованные копии. Для работающей базы SQLite используйте механизм оперативного резервного копирования.

См. [Примеры настройки и спецификация Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
