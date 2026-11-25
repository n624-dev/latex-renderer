---
slug: server-setup
category: Vlastní server
title: Průvodce nastavením serveru
description: Nastavte přihlášení, HTTPS a provozní limity připraveného serveru z prohlížeče nebo terminálu.
navOrder: 64
updated: "2026-11-22"
since: "v1.4.0"
---

## Volba postupu {#どの手順を使うか}

Pro novou instalaci [připravte server](/cs/docs/self-hosting/#準備するもの) a otevřete průvodce v **prohlížeči**. U stávající instalace stejným průvodcem změníte metodu přihlášení a provozní limity.

- Na serveru spusťte `sudo n624-latex server setup --plan` a zkontrolujte potřebné balíčky a volné místo. Doplňte uvedené požadavky a kontrolu zopakujte.
- Při změně existující instalace s vyhrazeným HTTPS nebo HTTPS v LAN (Akebi) přidejte ke spouštěcímu příkazu `--ingress`.
- Pokud Docker na minimálním hostiteli hlásí chybějící moduly jádra, postupujte podle pokynů a zkuste to znovu. Pokud například vyžaduje `nf_tables`, správce musí spustit `sudo modprobe nf_tables`.

## Otevření v prohlížeči {#ブラウザで開く}

Připojte se přes SSH jako uživatel pro nasazení bez práv roota a spusťte následující příkaz. **Ponechte terminál otevřený až do dokončení nastavení.**

```sh
sudo n624-latex server setup --web
```

1. Při první instalaci si projděte přípravné kroky a pro pokračování napište `PREPARE`. Vyčkejte na stažení podepsané verze, přípravu služeb a vytvoření a ověření prvního prostředí TeX.
2. V terminálu najděte jednorázovou adresu URL. Platí **5 minut**.
3. Otevřete ji na serveru nebo použijte **přesměrování portu SSH** pro přístup ke stejnému portu ze svého počítače. Pokud se zobrazí port `41234`, v jiném místním terminálu spusťte následující příkaz a v prohlížeči otevřete adresu z průvodce.

```bash
ssh -N -L 127.0.0.1:41234:127.0.0.1:41234 admin@latex.example.com
```

> [!WARNING]
> Adresu pro nastavení nesdílejte a její port nezpřístupňujte na internetu ani přes reverzní proxy.

## Kontrola a použití konfigurace {#プレビューから適用まで}

1. **Vyberte způsob přístupu a přihlášení.** U nové instalace nastavte HTTPS a prvního vlastníka. Hesla a klientská tajemství OIDC zadejte do skrytých polí.
2. **Zkontrolujte náhled.** Ověřte veřejnou adresu URL a způsob přístupu. Měníte-li metodu, připravte identitu vlastníka pro novou metodu, dokud se ještě můžete přihlásit.
3. **Použijte změny.** Vyčkejte na spuštění nebo restart služeb.
4. **Přihlaste se a vytvořte PDF.** V jiném okně prohlížeče [ověřte instalaci](/cs/docs/self-hosting/#導入完了の確認).

Pokud v nové instalaci zapínáte hesla i OIDC, nejprve zaregistrujte vlastníka s heslem a k účtu přidejte `issuer` a `subject` pro OIDC. V provozních limitech označuje spouštěcí práh volnou RAM před spuštěním úlohy, zatímco limit za běhu určuje, kolik RAM může použít kontejner.

## Kontrola přerušené změny {#中断した変更を確認する}

- Při výpadku spojení po zahájení změn zkontrolujte nejprve výsledek stejné operace.
- Pokud proces průvodce skončil, spusťte jej znovu pro stejný cíl a na webu vyberte **Recover** nebo v terminálu **`RECOVER`**. Byl-li již vlastník zaregistrován, průvodce využije existující záznam a pokračuje k potvrzení. Tato obnova nastavení neobnovuje starší zálohu databáze.
- Soubory pro obnovu mohou obsahovat tajné údaje TLS či OIDC. Neupravujte je ručně. Při žádosti o pomoc uveďte jen zobrazený kód chyby a fázi operace.

## Otevření v terminálu {#端末で開く}

```sh
sudo n624-latex server setup --cui
```

Při změně stávajícího serveru zadejte každou hodnotu, nebo stiskněte Enter v prázdném poli pro její zachování. Pro automatické HTTPS v LAN při instalaci vyberte `LAN` a pokračujte podle pokynů. Při prvním nastavení vlastního HTTPS nebo nastavení stávající trasy Cloudflare v terminálu zadejte požadovaný JSON na jediném řádku. Pokud nastavení provádíte poprvé, [začněte v prohlížeči](#ブラウザで開く).

### Starší verze a ruční instalace {#旧版-手動配置の場合}

> [!DETAILS] Přímé spuštění server-setup.mjs
>
> Pokud jste server připravili bez APT s vyhrazeným uživatelem, Node.js a Dockerem bez práv roota a ověřenou distribuci umístili do `/opt/latex-renderer/current`, spusťte přímo `server-setup.mjs`. Přípravu nového hostitele popisují [pokyny k ruční instalaci](/cs/docs/self-hosting/#現在の提供状況).
>
> | Úloha | Spouštěcí argument | Podmínky |
> | --- | --- | --- |
> | Změna současného přihlášení či limitů | `--existing` | Zaregistrovaný vlastník a fungující služby |
> | Konfigurace a registrace prvního vlastníka | `--initial` | Připravená distribuce a prostředí, bez provozní konfigurace a původní databáze |
> | Změna spravovaného vyhrazeného HTTPS | `--ingress` | Vyhrazené HTTPS v režimu standalone. Přechod ze sdíleného Nginx je samostatná operace. |
>
> - **Terminálové rozhraní**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --cui --existing
>   ```
> - **Rozhraní v prohlížeči**
>   ```bash
>   sudo /usr/local/bin/node /opt/latex-renderer/current/deploy/scripts/server-setup.mjs --web --existing
>   ```

Viz [Specifikace vstupů průvodce a obnovy](https://github.com/n624-dev/latex-renderer/blob/main/docs/server-settings-wizard.md).
