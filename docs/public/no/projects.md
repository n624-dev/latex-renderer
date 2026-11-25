---
slug: projects
category: Prosjekter
title: Klargjør TeX- og ZIP-filer
description: Klargjør inndata, kontroller grensene og prøv et minimalt prosjekt med LuaLaTeX.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Prosjektstruktur {#構成}

- **Dokument i én fil.** Last opp `.tex` direkte i nettappen, eller kjør `n624-latex main.tex` i CLI.
- **Dokument med bilder, bibliografi eller flere kildefiler.** Pakk alt i **ett ZIP-arkiv** som bevarer relative stier. I CLI kan du også oppgi en mappe.
- **Lag ZIP-arkivet.** Velg innholdet i mappen, for eksempel `main.tex` og `images/`, når du komprimerer. Tar du med den overordnede mappen, må du angi en startsti som `project/main.tex` ved konvertering.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Startfil og relative stier**
Som standard er hoveddokumentet `main.tex` i prosjektroten. Selv om du velger en `.tex` i en undermappe, for eksempel `docs/main.tex`, **er prosjektroten alltid arbeidsmappen for kompileringen**. For å inkludere filen i samme undermappe fra `docs/main.tex` skriver du filnavnet `body.tex` med stien `\input{docs/body.tex}`. Skriver du `\input{body.tex}`, leter kompilatoren etter `body.tex` i roten.

## Minimalt eksempel med japansk tekst {#日本語の最小例}

Standardmotoren er **LuaLaTeX**. Vil du prøve et japansk dokument, lagrer du følgende som `main.tex` med UTF-8-koding.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Søk etter tilgjengelige pakker og skrifter i [renderingsmiljøet](/app/environment/). Listen genereres fra serverens container ved utrulling og brukes også til søk i Remote MCP. Mangler det en pakke, send administratoren den aktuelle meldingen fra `compile.log`.

## Lagrede prosjekter og revisjoner {#保存projectと改訂}

Dokumenter som konverteres i nettappen (`/app/`), lagres i prosjekter.

- **Automatisk registrering av revisjoner.** Hver nye kombinasjon av innhold, hoveddokument, motor og utdataformater lagres som en prosjektrevisjon. Tidligere revisjoner blir liggende i historikken.
- **Konverter en eldre revisjon.** Klikk på **Konverter på nytt** for å bruke det lagrede dokumentet og motoren. Hvis du endrer utdataformat her, legges resultatet til i konverteringshistorikken for samme revisjon.
- **Deling og sletting.** Nettappen, CLI, HTTP-API-et og MCP deler brukerens prosjekter og revisjoner. Ved sletting skjules prosjektoppføringen. Eksisterende inn- og utdata ryddes etter lagringstiden. Kontakt administratoren hvis du trenger fullstendig, umiddelbar sletting. Inndata som aktive revisjoner viser til, teller mot brukerkvoten. Se [Deling og lagring](/no/docs/reference/#保存プロジェクトの共有-保持).

### Rediger i nettleseren {#ブラウザーで編集する}

Åpne et lagret prosjekt og velg **Rediger TeX**. Endringene lagres i utkastet. Kompilering starter når du slutter å skrive og oppdaterer PDF-filen ved vellykket kjøring. Mislykkes forhåndsvisningen, kan du se den siste tilgjengelige PDF-filen og hvilken utkastversjon den svarer til.

Nye prosjekter åpnes med en tom `main.tex`. Så lenge hoveddokumentet er tomt, kan du starte med en mal. Velg **Rediger fra denne revisjonen** hvis du vil fortsette fra en lagret versjon. Bekreft før et eksisterende utkast erstattes.

Vil du bare kompilere ved behov, slå av **Kompiler automatisk** og klikk på **Kompiler**. Velg **Utdata for den lagrede versjonen** og klikk på **Lagre en versjon** for å beholde utkastet og innstillingene. For SVG åpner du den lagrede revisjonen og velger **Konverter på nytt**.
Redigeringsverktøyet viser kompileringsstatus og forhåndsvisning mens du arbeider.

## Filer som holdes utenfor opplastingen {#送信から除外されるもの}

- **Automatiske unntak.** CLI hopper over `.git`, `.render` og LaTeX-hjelpefiler som `.aux`. Symbolske lenker avvises.
- **Filer som ikke støttes.** Flytt unødvendige mapper som `node_modules` ut av prosjektet. Inneholder mappen en fil med en filendelse som ikke støttes, viser CLI stien og stopper. Vil du beholde en fil som `README.md` i prosjektet uten å sende den, legg til en linje i `.latexrenderignore` i prosjektroten med `README.md`. Serveren kontrollerer de samme reglene for filendelser i ZIP-arkivet.
- **Tillatte filendelser** (uavhengig av store og små bokstaver)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  `.bst`-filer er bibliografistiler for BibTeX og kan ligge i undermapper. Hvis en egen stil bruker en filendelse som ikke er oppført, ta kontakt med administratoren før du endrer den.

## Grenser {#制限}

- **Antall filer.** Høyst 500.
- **Standardstørrelser.** 20 MiB for ZIP-arkivet, 100 MiB totalt etter utpakking og 20 MiB per fil.
- **Startfil.** Relativ sti til en `.tex` i inndataene. Standarden er `main.tex` i roten.
- **Sikkerhet.** Skalltilgang fra TeX (inkludert `\write18`), kjøring av eksterne kommandoer og eksterne nettverksforbindelser er deaktivert.
- **Ressurser.** Administratoren angir tidsgrenser, lagringskvote per bruker og hvor lenge resultatene beholdes.
