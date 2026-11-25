---
slug: web
category: Nettapp
title: Konverter dokumenter i nettleseren
description: Lag en PDF av en TeX-fil eller et ZIP-arkiv og se resultater fra tidligere konverteringer.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Lag en PDF i nettleseren {#ブラウザでpdfへ変換}

1. Åpne [nettappen](/app/) og logg inn med metoden administratoren har oppgitt.
2. Velg filer eller dra dem inn på siden.
   - Består dokumentet av én fil, velger du `.tex` direkte.
   - Inneholder dokumentet bilder, bibliografi eller flere `.tex`-filer (for eksempel via `\input`), legg dokumentet og de tilhørende filene i en `.zip`. Se [Støttede filer og ZIP-struktur](/no/docs/projects/).
   - Velger du flere separate `.tex`-filer, konverteres hver fil som et eget dokument.
3. Hvis ZIP-arkivet inneholder flere `.tex`-filer og en meny vises, velger du hoveddokumentet som startfil.
4. Klikk på **Konverter til PDF**. Når konverteringen er ferdig, viser resultatsiden PDF-filen og forhåndsvisningene.

Hvis du vil bruke en annen motor enn LuaLaTeX, velger du den under **Mål og utdatavalg → Motor**. I [renderingsmiljøet](/app/environment/) ser du hvilke motorer som finnes, og om PDF, SVG og SVG-plassering er verifisert. pLaTeX og upLaTeX krever den japanske språksamlingen på serveren.

## Rediger et dokument i nettleseren {#ブラウザーで文書を編集する}

1. Åpne et dokument i [Prosjekter](/app/projects/) og velg **Rediger TeX**. Et nytt prosjekt starter med en tom `main.tex`. Du kan også velge en mal.
2. Endringene lagres automatisk i utkastet. Legg til bilder eller bibliografifiler med **Legg ved fil**.
3. Slå på **Kompiler automatisk** for å oppdatere PDF-filen når du tar en pause i skrivingen. Klikk på **Kompiler** for å oppdatere med en gang.
4. Klikk på **Lagre en versjon** for å beholde inndataene i historikken. Med **Rediger fra denne revisjonen** kan du fortsette fra en lagret versjon. Hvis det finnes et utkast fra før, blir du bedt om å bekrefte før det erstattes.

Åpne **Behandle filer** for å legge til eller legge ved filer. Under **Innstillinger** kan du endre motor, automatisk kompilering og visningsspråk eller lagre en versjon. Knappen **⋯** i PDF-panelet åpner alternativer for zoom og PNG.

Hvis kompileringen mislykkes, beholdes utkastet og den siste vellykkede PDF-filen. Velg en feilmelding med filnavn og linjenummer for å gå til linjen. På mobil kan du veksle mellom **Kode**, **PDF** og **Feil**. Bruk **PNG (lett forhåndsvisning)** hvis PDF-filen bruker lang tid på å lastes.

Midlertidige forhåndsvisninger er bare tilgjengelige i redigeringsverktøyet. Vil du beholde en PDF, laster du den ned med **Lagre PDF**.

Redigeringsverktøyet bruker UTF-8. Åpne filer i Shift_JIS eller EUC-JP i en teksteditor med den opprinnelige kodingen, kontroller tegnene og lagre en kopi i UTF-8. Legg ved kopien med samme navn og bekreft erstatningen.

## Hent formler og TikZ-figurer som SVG {#数式や-tikz-を-svg-で取得する}

1. Åpne **Mål og utdatavalg** før konvertering og velg **Eksporter også formler og TikZ som SVG**.
2. PDF-filen kan lastes ned så snart den er ferdig.
3. **Delvis vellykket** betyr at PDF-filen er ferdig, men at uthentingen av SVG mislyktes. Lagre PDF-filen først og klikk ved behov på **Prøv bare SVG på nytt**.

Til å begynne med lages bare PNG-forhåndsvisningen av den første siden. Øvrige sider lages når du åpner dem. Du kan laste ned den ferdige PDF-filen mens forhåndsvisningene klargjøres. Se [Hent PDF, PNG og SVG](/no/docs/outputs/).

## Åpne tidligere dokumenter og resultater {#以前の文書や結果を開く}

- **[Historikk](/app/history/)** viser fremdrift og resultatfiler. Du kan gå tilbake til den samme resultatsiden etter at du har lukket nettleseren.
- **[Prosjekter](/app/projects/)** viser lagrede dokumenter og revisjoner. For å bruke tidligere inndata åpner du revisjonen og klikker på **Konverter på nytt**.
- Under **[Renderingsmiljø](/app/environment/)** kan du søke etter LaTeX-pakker og skrifter som finnes på serveren.

## Offentlig og privat informasjon {#公開される情報}

- **Sider med innlogging.** Logg inn i nettappen (`/app/`) for å se dokumentene og konverteringene dine i historikken eller på resultatsiden. Bare administratorer og eiere har tilgang til administrasjonen (`/admin/`). Se [Sikkerhet for kontoer og dokumenter](/no/docs/security/).
- **Offentlige sider.** Hvis du ikke kan logge inn, se [tjenestestatus](/status/) eller [Feilsøking](/no/docs/troubleshooting/). CLI ligger under [Nedlastinger](/downloads/), og integrasjonsspesifikasjonene finnes i [offentlig API](/no/docs/api/).
