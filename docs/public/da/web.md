---
slug: web
category: Webapp
title: Konvertér dokumenter i browseren
description: Opret en PDF fra en TeX-fil eller et ZIP-arkiv, og se resultater fra tidligere konverteringer.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Opret en PDF i browseren {#ブラウザでpdfへ変換}

1. Åbn [webappen](/app/), og log ind med den metode, administratoren har angivet.
2. Vælg filerne, eller træk dem ind på siden.
   - Består dokumentet af én fil, skal du vælge `.tex` direkte.
   - Indeholder dokumentet billeder, bibliografi eller flere `.tex`-filer (f.eks. via `\input`), skal du samle dokumentet og de nødvendige filer i en `.zip`. Se [Understøttede filer og ZIP-struktur](/da/docs/projects/).
   - Vælger du flere separate `.tex`-filer, konverteres hver fil som et selvstændigt dokument.
3. Hvis ZIP-arkivet indeholder flere `.tex`-filer, og du får vist en valgmulighed, skal du vælge hoveddokumentet som startfil.
4. Klik på **Konvertér til PDF**. Efter konverteringen vises PDF-filen og sidevisningerne på resultatsiden.

Vil du bruge en anden motor end LuaLaTeX, skal du vælge den under **Destination og outputindstillinger → Motor**. I [renderingsmiljøet](/app/environment/) kan du se de tilgængelige motorer, og om PDF, SVG og SVG-placering er verificeret. pLaTeX og upLaTeX kræver den japanske sprogsamling på serveren.

## Rediger et dokument i browseren {#ブラウザーで文書を編集する}

1. Åbn et dokument under [Projekter](/app/projects/), og vælg **Rediger TeX**. Et nyt projekt starter med en tom `main.tex`. Du kan også vælge en skabelon.
2. Ændringerne gemmes automatisk i kladden. Tilføj billeder eller bibliografifiler med **Vedhæft fil**.
3. Slå **Kompilér automatisk** til for at opdatere PDF-filen, når du holder op med at skrive. Klik på **Kompilér** for at opdatere med det samme.
4. Klik på **Gem en version** for at bevare inputtet i historikken. Med **Rediger fra denne revision** kan du fortsætte fra en gemt version. Hvis der allerede findes en kladde, skal du bekræfte, før den erstattes.

Åbn **Administrer filer** for at tilføje eller vedhæfte filer. Under **Indstillinger** kan du ændre motor, automatisk kompilering og visningssprog eller gemme en version. Knappen **⋯** i PDF-panelet åbner indstillinger for zoom og PNG.

Hvis kompileringen mislykkes, bevares kladden og den seneste fungerende PDF. Vælg en fejl med filnavn og linjenummer for at gå til linjen. På mobilen kan du skifte mellem **Kode**, **PDF** og **Fejl**. Brug **PNG (let forhåndsvisning)**, hvis PDF-filen er langsom at vise.

Midlertidige forhåndsvisninger vises kun i editoren. Vil du beholde en PDF, kan du hente den med **Gem PDF**.

Editoren bruger UTF-8. Åbn filer i Shift_JIS eller EUC-JP i en teksteditor med deres oprindelige kodning. Kontroller tegnene, og gem en kopi i UTF-8. Vedhæft kopien med samme navn, og bekræft erstatningen.

## Hent formler og TikZ-figurer som SVG {#数式や-tikz-を-svg-で取得する}

1. Åbn **Destination og outputindstillinger** før konvertering, og markér **Eksportér også formler og TikZ som SVG**.
2. Du kan hente PDF-filen, så snart den er klar.
3. **Delvis gennemført** betyder, at PDF-filen er klar, men at SVG-udtrækket mislykkedes. Gem PDF-filen først, og klik om nødvendigt på **Prøv kun SVG igen**.

Først oprettes kun en PNG-forhåndsvisning af den første side. Øvrige sider oprettes, når du åbner dem. Du kan hente den færdige PDF, mens forhåndsvisninger klargøres. Se [Hent PDF, PNG og SVG](/da/docs/outputs/).

## Åbn tidligere dokumenter og resultater {#以前の文書や結果を開く}

- **[Historik](/app/history/)** viser status og resultatfiler. Du kan vende tilbage til samme resultatside efter at have lukket browseren.
- **[Projekter](/app/projects/)** viser gemte dokumenter og revisioner. For at konvertere tidligere input åbner du revisionen og klikker på **Konverter igen**.
- Under **[Renderingsmiljø](/app/environment/)** kan du søge efter LaTeX-pakker og skrifttyper på serveren.

## Offentlige og private oplysninger {#公開される情報}

- **Sider med login.** Log ind i webappen (`/app/`) for at se dine dokumenter og konverteringer i historikken eller på resultatsiderne. Kun administratorer og ejere har adgang til administrationen (`/admin/`). Se [Sikkerhed for konti og dokumenter](/da/docs/security/).
- **Offentlige sider.** Kan du ikke logge ind, kan du se [tjenestens status](/status/) eller [Fejlfinding](/da/docs/troubleshooting/). CLI findes under [Downloads](/downloads/), og integrationsspecifikationerne findes i [det offentlige API](/da/docs/api/).
