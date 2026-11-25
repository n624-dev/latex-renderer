---
slug: lan-https-authority
category: Vlastní server
title: Provoz vlastní certifikační služby Akebi
description: Nastavte delegaci DNS pro doménu LAN, vydávání certifikátů a otevřenou registraci nebo registraci na pozvánku.
navOrder: 67
updated: "2026-11-22"
since: "v1.6.0"
---

Tento návod je určen správcům vlastní certifikační služby. Použití sdílené služby pro LaTeX Renderer popisuje [HTTPS v místní síti pomocí Akebi](/cs/docs/lan-https/).

Připravte zónu DNS, kterou můžete delegovat, hostitel s Linuxem (amd64 nebo arm64) dostupný veřejně přes DNS a HTTPS, Node.js 24 či 26 a účet u vaší certifikační autority. Použijte distribuci serveru s podpisem ověřeným podle [postupu ručního stažení](/cs/docs/self-hosting/#v1-6-9をダウンロードして検証).

## Delegace DNS {#dns-を委任する}

V nadřazené zóně nastavte tyto záznamy. DNS Akebi musí být z internetu dostupné na **portu 53 přes UDP i TCP**.

| Typ | Název | Hodnota |
| --- | --- | --- |
| `A` | `ns1.example.org` | Veřejná IPv4 adresa DNS serveru Akebi |
| `A` | `akebi.example.org` | Veřejná IPv4 adresa reverzní HTTPS proxy pro API Akebi |
| `NS` | `lan.example.org` | `ns1.example.org` |
| `CNAME` | `_acme-challenge.akebi.example.org` | `_acme-challenge.authority-control.lan.example.org` |

- Vyhraďte `ns1.example.org` pro DNS a hostitele API (`akebi.example.org`) umístěte mimo zónu certifikátů LAN (`lan.example.org`).
- Po delegaci Akebi dynamicky vrací záznamy `A` a `AAAA` odvozené z IP adres v LAN a záznamy `TXT` potřebné k ověření ACME. V nadřazené zóně není nutný záznam pro každou IP adresu.

## Nasazení služby {#サービスを配置する}

1. **Vytvořte uživatele a adresáře stavu.** Oddělte oprávnění aplikace pomocí vyhrazeného uživatele a skupiny se jménem `latex-renderer-lan-authority`. Vytvořte `/var/lib/latex-renderer-lan-authority` a jeho podadresář `keyless` s tímto vlastníkem a skupinou, oba v režimu `0700`.
2. **Připravte konfigurační adresář.** Vytvořte `/etc/latex-renderer-lan-authority` s vlastníkem a skupinou `root:latex-renderer-lan-authority` a režimem `0750`. Z ověřené distribuce do něj zkopírujte `deploy/lan-https/examples/authority.json` a nastavte `root:latex-renderer-lan-authority` a režim `0640`.
3. **Upravte `authority.json`.**
   - `policy.serverOrigin` určuje HTTPS adresu API, například `https://akebi.example.org`.
   - `policy.lanDomain` určuje delegovanou doménu LAN, například `lan.example.org`.
   - `dns.nameserver` a `dns.listeners` určují veřejný název DNS serveru a adresy pro naslouchání. Používá-li port 53 jiný DNS server, zvolte nekolidující veřejnou IP adresu.
   - Navažte `http` na rozhraní zpětné smyčky.
   - V `issuers` nastavte veřejnou CA. Vyžaduje-li External Account Binding (EAB), použijte určený soubor `eabFile` vlastněný uživatelem služby v režimu `0600` a uložte do něj `kid` a `hmacKey`. Má-li doména záznamy CAA, povolte v nich vybranou CA.
4. **Nainstalujte kód a jednotku systemd.** Příklad předpokládá ověřené zdroje vlastněné rootem v `/path/to/verified-release`.

```bash
source=/path/to/verified-release
sudo /usr/local/bin/node "$source/deploy/lan-https/install-authority.mjs" "$source"
sudo install -m 0644 "$source/deploy/systemd/latex-renderer-lan-authority.service" /etc/systemd/system/
sudo install -m 0644 "$source/deploy/systemd/journald@latex-renderer-lan.conf" /etc/systemd/
sudo systemctl daemon-reload
```

5. **Inicializujte stav a spusťte službu.** `init` spusťte jen poprvé.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority init \
  --config /etc/latex-renderer-lan-authority/authority.json
sudo systemctl enable --now latex-renderer-lan-authority.service
```

## Získání certifikátu HTTPS {#https-証明書を用意する}

Příklad pro zpřístupnění API pomocí Nginx je v `deploy/lan-https/examples/authority.nginx.conf` a předává požadavky API na zpětné smyčce. Před zapnutím TLS v Nginx získejte certifikát API.

Používáte-li automatické obnovování pomocí Certbotu, zadejte CA, kontaktní údaje, souhlas s podmínkami a potřebné údaje EAB do `/etc/latex-renderer-lan-authority/certbot.ini` dostupného pouze rootovi. Použijte klíč ECDSA P-256. Vyčkejte na rozšíření delegace DNS a spusťte následující příkazy.

```bash
hooks=/opt/latex-renderer-lan-authority/current/deploy/lan-https
sudo certbot certonly --non-interactive --config /etc/latex-renderer-lan-authority/certbot.ini \
  --manual --preferred-challenges dns \
  --manual-auth-hook "$hooks/operator-dns-hook.sh present" \
  --manual-cleanup-hook "$hooks/operator-dns-hook.sh cleanup" \
  --deploy-hook "$hooks/operator-api-certificate-hook.sh" \
  --cert-name akebi-authority -d akebi.example.org
```

Po vydání upravte název serveru a cesty k certifikátům v Nginx, ověřte syntaxi pomocí `nginx -t`, použijte změny a zkontrolujte časovač obnovování Certbotu.

- **Pro poskytování režimu Keyless** získejte samostatný zástupný certifikát ECDSA P-256 obsahující pouze `*.lan.example.org`. V předchozím příkazu změňte `--cert-name` na `akebi-keyless`, `-d` na `'*.lan.example.org'` a `--deploy-hook` na `"$hooks/operator-certificate-hook.sh"`. Pro samotný režim veřejné CA jej nepotřebujete.

## Nastavení registrace {#登録方法を設定する}

V `authority.json` vyberte metodou `policy.registration` způsob registrace klientských serverů.

- `"open"` umožňuje automatickou registraci.
- `"invite"` vyžaduje kód vydaný správcem.

Pro registraci na pozvánku vydejte následujícím příkazem časově omezený kód s omezeným počtem použití. Bezpečným kanálem jej předejte pouze příjemci.

```bash
sudo runuser -u latex-renderer-lan-authority -- /usr/local/bin/node \
  /opt/latex-renderer-lan-authority/current/deploy/lan-https/cli.mjs authority invite \
  --config /etc/latex-renderer-lan-authority/authority.json --uses 1 --ttl-hours 24
```

V obou režimech platí limity registrací, četnosti vydávání a počtu uložených položek i zásady vydávání certifikátů dané CA.

## Vnější ověření {#外部から確認する}

Na externím počítači zkontrolujte delegaci DNS, odpověď SOA přes UDP a TCP, překlad názvů odvozených z IP a odpověď zjišťování služby přes HTTPS.

```bash
dig +short NS lan.example.org
dig @ns1.example.org lan.example.org SOA +short
dig @ns1.example.org lan.example.org SOA +tcp +short
dig @ns1.example.org 192-168-1-50.lan.example.org A +short
curl -fsS https://akebi.example.org/.well-known/latex-renderer-lan-https
```

Až všechny kontroly uspějí, připojte testovací server LaTeX Renderer podle návodu [Nastavení přístupu z LAN](/cs/docs/lan-https/#lan-向けに設定する) a ověřte vydání certifikátu a přihlášení. Pokud CA určí čas opakování pokusu, vyčkejte do té doby.

**Zálohy.** Do šifrovaných záloh zahrňte `/var/lib/latex-renderer-lan-authority`, `/etc/latex-renderer-lan-authority`, účty u CA a nastavení obnovování Certbotu. Pro běžící databázi použijte online zálohování SQLite.

Viz [Příklady konfigurace a specifikace Akebi](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
