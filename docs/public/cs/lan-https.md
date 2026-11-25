---
slug: lan-https
category: Vlastní server
title: HTTPS v místní síti pomocí Akebi
description: Přistupujte k serveru přes adresu HTTPS odvozenou z jeho místní IP adresy.
navOrder: 66
updated: "2026-11-22"
since: "v1.6.0"
---

## Přístup pomocí IP adresy v LAN {#lan-の-ip-アドレスからアクセスする}

Akebi převádí soukromou IP adresu serveru na název hostitele dostupný přes HTTPS.

V průvodci LaTeX Renderer nastavte sdílenou certifikační službu. Chcete-li provozovat vlastní, viz [Provoz vlastní certifikační služby Akebi](/cs/docs/lan-https-authority/).

- **Příklad pro IPv4.** Pro IP adresu `192.168.1.50` a doménu LAN `lan.example.org` bude výsledná adresa `https://192-168-1-50.lan.example.org`.
- **IPv6.** Název obsahuje všech osm skupin podporované soukromé adresy v rozepsaném tvaru. Použijte přesnou adresu URL zobrazenou při nastavení.

**Požadavky na síť a DNS**
Klient musí mít přístup do sítě LAN serveru. Pokud se název nepodaří přeložit, ověřte, zda směrovač nebo resolver DNS neblokuje odpovědi se soukromou IP adresou kvůli **ochraně proti DNS rebindingu**. V případě potřeby udělte výjimku pouze používané doméně LAN.

## Výběr typu certifikátu {#証明書の方式を選ぶ}

| Metoda | Požadavky a vlastnosti |
| --- | --- |
| **Sdílená služba, veřejná CA** | Nastavte sdílenou službu a přijměte podmínky certifikační autority. Soukromý klíč certifikátu zůstává na serveru. |
| **Vlastní služba, veřejná CA** | Adresa URL a doména LAN [vlastní služby Akebi](/cs/docs/lan-https-authority/), případně kód pozvánky. |
| **Keyless** | Vyžaduje kompatibilní službu, které se předává podepisování při navazování TLS. |
| **Stávající certifikát nebo soukromá CA** | Certifikát odpovídající názvu serveru a jeho soukromý klíč. U soukromé CA nastavte důvěru v kořenový certifikát na serveru i všech klientech. |

> [!NOTE]
> - U veřejné CA se názvy hostitelů z vydaných certifikátů objeví ve **veřejných protokolech transparentnosti certifikátů (CT)**.
> - Dvě místní sítě na různých místech se stejnou soukromou IP adresou a doménou LAN mají z pohledu prohlížeče **stejný počátek** a sdílejí soubory cookie a další uložená data.

## Nastavení přístupu z LAN {#lan-向けに設定する}

1. U nové instalace [připravte server](/cs/docs/self-hosting/#準備するもの) a příkazem `sudo n624-latex server setup --web` otevřete [průvodce](/cs/docs/server-setup/#ブラウザで開く). Pro změnu stávajícího serveru se spravovaným vyhrazeným HTTPS použijte `sudo n624-latex server setup --ingress --web`.
2. Jako způsob přístupu vyberte **LAN** a zadejte síťové rozhraní, soukromou IP adresu, povolené podsítě klientů a port HTTPS.
3. Zvolte certifikační službu a metodu. U sdílené služby se nastaví adresa URL `https://akebi.n624.net` a doména LAN `lan.n624.net`. Při použití změn se server zaregistruje bez pozvánky. Pro veřejnou CA si přečtěte a přijměte podmínky. Používáte-li vlastní službu s pozvánkami, zadejte kód od správce.
4. Před použitím ověřte vytvořenou adresu HTTPS a povolené podsítě. Pro aplikaci nadále platí přihlášení heslem nebo přes OIDC.
5. Na jiném počítači z povolené podsítě otevřete adresu, ověřte, že certifikát nevyvolává varování, přihlaste se a převeďte zkušební dokument.

Zřízení vlastní služby popisuje [Provoz vlastní certifikační služby Akebi](/cs/docs/lan-https-authority/).

## Kontrola stavu certifikátu {#証明書の状態を確認する}

Následující příkazy zobrazí službu, časovač obnovy a protokoly jejího jmenného prostoru.

```bash
systemctl status latex-renderer-lan-https.service latex-renderer-lan-renew.timer
sudo journalctl --namespace=latex-renderer-lan --since '1 hour ago'
```

Při neúspěšném vydání nebo obnovení ověřte čas serveru, spojení HTTPS se službou, doménu, IP adresu a čas dalšího pokusu určený CA. Při přechodné chybě zůstane platný certifikát zachován. Časovač naváže na uložený stav vydávání. Neshodují-li se klíč a stav, zkontrolujte uchované stavové soubory stejné generace.

Viz [Návrh Akebi a řešení potíží](https://github.com/n624-dev/latex-renderer/blob/main/docs/akebi-lan-https.md).
