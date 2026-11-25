---
slug: troubleshooting
category: Felsökning och säkerhet
title: Felsökning
description: Hitta orsaken till problem med inloggning, installation, konvertering och nedladdning.
navOrder: 60
updated: "2026-11-22"
since: "v1.0.0"
---

## Börja här {#確認する順序}

1. **Kontrollera [tjänstens status](/status/)** för att se om ett allmänt avbrott eller underhåll pågår.
2. **Kontrollera det befintliga jobbet.** Om konverteringen redan har startat, öppna samma jobb under **Historik** eller kör `n624-latex jobs get <jobId>` i CLI.
3. **Läs diagnostik och logg.** På webben öppnar du diagnostiken på resultatsidan. I CLI, kontrollera `.render/errors.json` och den detaljerade loggen `.render/compile.log`.

## Vanliga problem {#代表的な問題}

### Installation och inloggning {#インストール-ログイン}

- **`n624-latex` eller `latex-render` hittas inte.**
  Öppna en ny terminal eller ett nytt PowerShell-fönster. Kvarstår problemet, kontrollera [PATH i Linux eller macOS](/sv/docs/client/#linux-macos) eller [installationsanvisningarna för Windows](/sv/docs/windows/#インストール).
- **Det går inte att logga in i webbappen.**
  Använd det registrerade kontot och administratörens metod (lösenord, OIDC eller Cloudflare Access). Se [Kontrollera Remote MCP-anslutningen](/sv/docs/mcp/#chatgptなどの接続を確認する) om en anslutning från ChatGPT eller Claude fastnar.
- **CLI returnerar `401` eller `403`.**
  Kör `n624-latex auth status` för att kontrollera den sparade nyckeln. Be administratören bekräfta att nyckeln är aktiv och har behörigheterna `render:create` och `render:read:own`. [Registrera vid behov nyckeln på nytt](/sv/docs/cli/#認証). För en egen server, kontrollera även [serveradressen (`LATEX_RENDER_BASE_URL`)](/sv/docs/cli/#接続先サーバー).

### Uppladdning och konvertering {#アップロード-変換}

- **Huvuddokumentet hittas inte i ZIP-arkivet.**
  Standardstartfilen är `main.tex` i roten. Kontrollera om du har packat den överordnade mappen eller ange den relativa sökvägen till dokumentet. Se [Förbered ZIP-arkivet](/sv/docs/projects/#構成).
- **En fil avvisas på grund av storlek eller filändelse.**
  Ta bort onödiga genererade filer och filer som inte stöds, eller konfigurera `.latexrenderignore`. Kontrollera [tillåtna filer och gränser](/sv/docs/projects/#制限).
- **Konverteringen står kvar i kön eller anslutningen bryts.**
  Servern kan fortfarande arbeta. Öppna samma resultatsida eller kontrollera samma jobb-ID innan du skapar ett nytt jobb.
- **Paket eller typsnitt saknas, eller tiden går ut.**
  Sök efter tillgängliga namn i [renderingsmiljön](/app/environment/). Vid tidsgräns, granska komplexa makron, stora bilder och TikZ-bilder kring den plats där loggen tar slut.

### Hämta filer {#成果物の取得}

- **PDF finns men SVG saknas.**
  Om **Delvis slutförd** visas, spara PDF-filen först och välj **Försök igen med endast SVG**. Se [Försök extrahera SVG igen](/sv/docs/outputs/#pdf-はあるが-svg-が失敗した場合).
- **PNG-förhandsvisningen förbereds fortfarande.**
  Vänta en stund eller öppna samma sida igen. Du kan hämta den färdiga PDF-filen direkt.
- **Målet används eller `OUTPUT_BUSY` visas.**
  Stäng visaren där utdatafilen är öppen eller vänta tills processen som skriver till samma mapp är klar och försök hämta igen.
- **Resultatet har gått ut eller utrymmet är slut.**
  Har resultatet gått ut, konvertera den sparade revisionen eller de lokala filerna på nytt. Har du nått din kvot, ta bort avslutade jobb som inte behövs. Är serverns disk full, meddela administratören.

## Be om hjälp {#問い合わせ}

- **Serveradministratören.** Ange tidpunkten, vilken åtgärd som stannade, felkoden och om möjligt jobb-ID:t (`job_...`).
- **Publikt ärende på GitHub.** Ange minsta möjliga steg för att återskapa felet utan hemligheter eller privata dokument. **Publicera aldrig API-nycklar, kakor, originaldokumentet, PDF-filen eller fullständiga oredigerade loggar.**
