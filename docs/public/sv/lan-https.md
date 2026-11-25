---
slug: lan-https
category: Egen server
title: HTTPS på det lokala nätet med Akebi
description: Nå servern med en HTTPS-adress som härleds från dess lokala IP-adress.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Anslut via LAN-adressen {#lan-の-ip-アドレスからアクセスする}

Akebi omvandlar serverns privata IP-adress till ett värdnamn som kan nås via HTTPS.

Konfigurera den delade certifikattjänsten i guiden för LaTeX Renderer. Vill du erbjuda en egen tjänst, se [Driv en egen Akebi-certifikattjänst](/sv/docs/lan-https-authority/).

- **IPv4-exempel.** Med IP-adressen `192.168.1.50` och LAN-domänen `lan.example.org` blir adressen `https://192-168-1-50.lan.example.org`.
- **IPv6.** Namnet innehåller alla åtta grupperna i den privata adressen utskrivna i full längd för adresstyper som stöds. Använd den exakta adress som visas vid konfigurationen.

**Nätverks- och DNS-krav**
Klienten måste kunna nå serverns lokala nät. Om namnet inte kan slås upp, kontrollera om routern eller DNS-resolvern blockerar svar med privata IP-adresser som **skydd mot DNS-rebinding**. Lägg vid behov till ett undantag enbart för den LAN-domän som används.

## Välj certifikattyp {#証明書の方式を選ぶ}

| Metod | Krav och egenskaper |
| --- | --- |
| **Delad tjänst, publik CA** | Konfigurera tjänsten och godkänn certifikatutfärdarens villkor. Certifikatets privata nyckel stannar på servern. |
| **Egen tjänst, publik CA** | Webbadress och LAN-domän för [din egen Akebi-tjänst](/sv/docs/lan-https-authority/) och vid behov en inbjudningskod. |
| **Keyless** | Kräver en kompatibel tjänst som utför signeringen vid TLS-handskakningen. |
| **Befintligt certifikat eller privat CA** | Certifikat som matchar servernamnet och tillhörande privata nyckel. För en privat CA måste server och klienter lita på rotcertifikatet. |

> [!NOTE]
> - För en publik CA visas värdnamnen från utfärdade certifikat i **publika Certificate Transparency-loggar (CT)**.
> - Två lokala nät på olika platser med samma privata IP-adress och LAN-domän får **samma ursprung** i webbläsaren och delar kakor och andra lagrade data.

## Konfigurera åtkomst från det lokala nätet {#lan-向けに設定する}

1. Vid nyinstallation, [förbered servern](/sv/docs/self-hosting/#準備するもの) och öppna [guiden](/sv/docs/server-setup/#ブラウザで開く) med `sudo n624-latex server setup --web`. För att ändra en befintlig server med hanterad dedikerad HTTPS använder du `sudo n624-latex server setup --ingress --web`.
2. Välj **LAN** som åtkomstväg och ange nätverksgränssnitt, privat IP-adress, tillåtna klientundernät och HTTPS-port.
3. Välj certifikattjänst och metod. För den delade tjänsten ställs adressen `https://akebi.n624.net` och LAN-domänen `lan.n624.net` in och servern registreras när du tillämpar ändringarna. Ingen inbjudan behövs. För en publik CA, läs och godkänn villkoren. För en egen tjänst med inbjudningar, ange administratörens kod.
4. Kontrollera den genererade HTTPS-adressen och tillåtna undernät innan du tillämpar ändringarna. Applikationens inloggning med lösenord eller OIDC gäller fortfarande.
5. Öppna adressen från en annan dator i ett tillåtet undernät. Kontrollera att ingen certifikatvarning visas, logga in och konvertera ett testdokument.

För att driva en egen tjänst, se [Driv en egen Akebi-certifikattjänst](/sv/docs/lan-https-authority/).

## Kontrollera certifikatets status {#証明書の状態を確認する}

Med följande kommandon ser du tjänsten, förnyelsetimern och loggarna i dess namnrymd.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Om utfärdande eller förnyelse misslyckas, kontrollera serverklockan, HTTPS-anslutningen till tjänsten, domänen, IP-adressen och tiden för nästa försök som utfärdaren angett. Ett tillfälligt fel lämnar det giltiga certifikatet intakt. Timern återupptar utfärdandet från sparat tillstånd. Om nyckel och tillstånd inte matchar, kontrollera sparade tillståndsfiler från samma generation.

Se [Akebis utformning och felsökning](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
