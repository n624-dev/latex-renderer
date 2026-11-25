---
slug: web
category: Webbapp
title: Konvertera dokument i webbläsaren
description: Skapa en PDF från en TeX- eller ZIP-fil och visa resultat från tidigare konverteringar.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Skapa en PDF i webbläsaren {#ブラウザでpdfへ変換}

1. Öppna [webbappen](/app/) och logga in på det sätt som administratören har angett.
2. Välj filerna eller dra dem till sidan.
   - Om dokumentet består av en enda fil väljer du `.tex` direkt.
   - Innehåller dokumentet bilder, en bibliografi eller flera `.tex`-filer (till exempel via `\input`), lägg dokumentet och alla filer det behöver i en `.zip`. Se [Filtyper och ZIP-struktur](/sv/docs/projects/).
   - Väljer du flera separata `.tex`-filer konverteras var och en som ett eget dokument.
3. Om ZIP-arkivet innehåller flera `.tex`-filer och en väljare visas, välj huvuddokumentet som startfil.
4. Klicka på **Konvertera till PDF**. När konverteringen är klar visas PDF-filen och förhandsvisningar av sidorna på resultatsidan.

Välj en annan motor än LuaLaTeX under **Mål och utdataalternativ → Motor**. I [renderingsmiljön](/app/environment/) ser du vilka motorer som finns och om PDF, SVG och SVG-positioner har verifierats. pLaTeX och upLaTeX kräver den japanska språksamlingen på servern.

## Redigera ett dokument i webbläsaren {#ブラウザーで文書を編集する}

1. Öppna ett dokument i [Projekt](/app/projects/) och välj **Redigera TeX**. Ett nytt projekt börjar med en tom `main.tex`. Du kan även välja en mall.
2. Ändringarna sparas automatiskt i utkastet. Lägg till bilder eller bibliografifiler med **Bifoga fil**.
3. Aktivera **Kompilera automatiskt** för att uppdatera PDF-filen när du gör en paus i skrivandet. Klicka på **Kompilera** för att uppdatera direkt.
4. Klicka på **Spara en version** för att spara underlaget i historiken. Välj **Redigera från denna revision** för att fortsätta från en sparad version. Finns det redan ett utkast får du bekräfta innan det ersätts.

Öppna **Hantera filer** för att lägga till eller bifoga filer. Under **Inställningar** väljer du motor, automatisk kompilering och visningsspråk, eller sparar en version. Knappen **⋯** i PDF-panelen öppnar alternativen för zoom och PNG.

Om kompileringen misslyckas behålls utkastet och den senaste fungerande PDF-filen. Välj ett fel med filnamn och radnummer för att gå till raden. På mobilen växlar du mellan **Kod**, **PDF** och **Fel**. Använd **PNG (resurssnål förhandsvisning)** om PDF-filen laddar långsamt.

Tillfälliga förhandsvisningar visas bara i redigeraren. Vill du behålla en PDF, ladda ned den med **Spara PDF**.

Redigeraren använder UTF-8. Öppna filer i Shift_JIS eller EUC-JP i en textredigerare med den ursprungliga kodningen. Kontrollera tecknen och spara en kopia i UTF-8. Bifoga kopian med samma namn och bekräfta att den ska ersätta filen.

## Hämta formler och TikZ-bilder som SVG {#数式や-tikz-を-svg-で取得する}

1. Öppna **Mål och utdataalternativ** innan du konverterar och markera **Exportera även formler och TikZ som SVG**.
2. Du kan ladda ned PDF-filen så snart den är klar.
3. **Delvis slutförd** innebär att PDF-filen är klar men att SVG-extraktionen misslyckades. Spara PDF-filen först och klicka vid behov på **Försök igen med endast SVG**.

Till en början skapas bara PNG-förhandsvisningen av första sidan. Övriga sidor skapas när du öppnar dem. Du kan ladda ned den färdiga PDF-filen medan förhandsvisningarna förbereds. Se [Hämta PDF, PNG och SVG](/sv/docs/outputs/).

## Öppna tidigare dokument och resultat {#以前の文書や結果を開く}

- **[Historik](/app/history/)** visar förlopp och resultatfiler. Du kan återvända till samma resultatsida även efter att du stängt webbläsaren.
- **[Projekt](/app/projects/)** visar sparade dokument och revisioner. För att konvertera ett tidigare underlag öppnar du revisionen och klickar på **Konvertera igen**.
- I **[Renderingsmiljö](/app/environment/)** kan du söka efter LaTeX-paket och typsnitt som finns på servern.

## Publik och privat information {#公開される情報}

- **Sidor med inloggning.** Logga in i webbappen (`/app/`) för att se dina dokument och konverteringar i historiken och på resultatsidorna. Bara administratörer och ägare har åtkomst till administrationen (`/admin/`). Se [Säkerhet för konton och dokument](/sv/docs/security/).
- **Publika sidor.** Om du inte kan logga in, se [tjänstens status](/status/) eller [Felsökning](/sv/docs/troubleshooting/). CLI finns under [Nedladdningar](/downloads/) och integrationsspecifikationerna under [Publikt API](/sv/docs/api/).
