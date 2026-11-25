---
slug: projects
category: Projekter
title: Klargør TeX- og ZIP-filer
description: Klargør input, kontroller grænserne, og prøv et minimalt projekt med LuaLaTeX.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Projektstruktur {#構成}

- **Dokument i en enkelt fil.** Upload `.tex` direkte i webappen, eller kør `n624-latex main.tex` i CLI.
- **Dokument med billeder, bibliografi eller flere kildefiler.** Pak alt i **ét ZIP-arkiv**, som bevarer relative stier. I CLI kan du også angive en mappe.
- **Opret ZIP-arkivet.** Vælg mappens indhold, f.eks. `main.tex` og `images/`, når du komprimerer. Tager du den overordnede mappe med, skal du angive en startsti som `project/main.tex` ved konvertering.

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
Standardhoveddokumentet er `main.tex` i projektets rodmappe. Selvom du vælger en `.tex` i en undermappe, f.eks. `docs/main.tex`, **er projektets rodmappe altid arbejdsmappen for kompileringen**. For at inkludere den tilstødende fil fra `docs/main.tex` angiver du `body.tex` med stien `\input{docs/body.tex}`. Skriver du `\input{body.tex}`, vil kompileren lede efter `body.tex` i rodmappen.

## Minimalt eksempel med japansk tekst {#日本語の最小例}

Standardmotoren er **LuaLaTeX**. Vil du prøve et japansk dokument, kan du gemme følgende som `main.tex` med UTF-8-kodning.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Søg efter tilgængelige pakker og skrifttyper i [renderingsmiljøet](/app/environment/). Listen dannes ud fra serverens container ved udrulning og bruges også til søgning i Remote MCP. Hvis en pakke mangler, skal du sende administratoren den tilhørende besked fra `compile.log`.

## Gemte projekter og revisioner {#保存projectと改訂}

Dokumenter, der konverteres i webappen (`/app/`), gemmes i projekter.

- **Automatiske revisioner.** Hver ny kombination af indhold, hoveddokument, motor og outputformater gemmes som en projektrevision. Tidligere revisioner bevares i historikken.
- **Konvertér en tidligere revision.** Klik på **Konverter igen** for at bruge det gemte dokument og den gemte motor. Hvis du ændrer outputformatet her, føjes resultatet til samme revisions konverteringshistorik.
- **Deling og sletning.** Webappen, CLI, HTTP-API'et og MCP deler brugerens projekter og revisioner. Når et projekt slettes, skjules dets post. Eksisterende input og output ryddes efter deres opbevaringstid. Kontakt administratoren, hvis fuldstændig sletning er nødvendig med det samme. Input, som aktive revisioner henviser til, tæller med i brugerens kvote. Se [Deling og opbevaring](/da/docs/reference/#保存プロジェクトの共有-保持).

### Rediger i browseren {#ブラウザーで編集する}

Åbn et gemt projekt, og vælg **Rediger TeX**. Ændringerne gemmes i kladden. Når du holder op med at skrive, starter kompileringen, og ved succes opdateres PDF-filen. Hvis forhåndsvisningen mislykkes, kan du se den seneste tilgængelige PDF og den kladdeversion, den svarer til.

Nye projekter åbnes med en tom `main.tex`. Så længe hoveddokumentet er tomt, kan du begynde med en skabelon. For at fortsætte fra en gemt version skal du vælge **Rediger fra denne revision**. Bekræft, før en eksisterende kladde erstattes.

Hvis du kun vil kompilere efter behov, skal du slå **Kompilér automatisk** fra og klikke på **Kompilér**. Vælg **Output for den gemte version**, og klik på **Gem en version** for at bevare kladden og dens indstillinger. For at få SVG skal du åbne den gemte revision og klikke på **Konverter igen**.
Editoren viser kompileringsstatus og forhåndsvisning, mens du arbejder.

## Filer, som ikke sendes med {#送信から除外されるもの}

- **Automatiske undtagelser.** CLI springer `.git`, `.render` og LaTeX-hjælpefiler som `.aux` over. Symbolske links afvises.
- **Ikke-understøttede filer.** Flyt unødvendige mapper som `node_modules` ud af projektet. Hvis du sender en mappe med en filtype, der ikke understøttes, viser CLI stien og stopper. Vil du beholde en fil som `README.md` i projektet uden at sende den med, skal du i `.latexrenderignore` i rodmappen tilføje en linje med `README.md`. Serveren kontrollerer de samme regler for filendelser i arkivet.
- **Tilladte filendelser** (uafhængigt af store og små bogstaver)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  `.bst`-filer er bibliografistile til BibTeX og må ligge i undermapper. Bruger din egen stil en filendelse, som ikke er med på listen, skal du kontakte administratoren, før du ændrer den.

## Grænser {#制限}

- **Antal filer.** Højst 500.
- **Standardstørrelser.** 20 MiB for ZIP-arkivet, 100 MiB i alt efter udpakning og 20 MiB per fil.
- **Startfil.** Relativ sti til en `.tex` i inputtet. Som standard bruges `main.tex` i rodmappen.
- **Sikkerhed.** Skaladgang fra TeX (herunder `\write18`), eksterne kommandoer og eksterne netværksforbindelser er deaktiveret.
- **Ressourcer.** Administratoren fastsætter tidsgrænser, lagerkvote per bruger og opbevaringstid for resultater.
