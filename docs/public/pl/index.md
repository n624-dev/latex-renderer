---
slug: index
category: Pierwsze kroki
title: Podręcznik LaTeX Renderer
description: Konwertuj dokumenty LaTeX na PDF w przeglądarce, w terminalu lub za pomocą asystenta AI.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Utwórz pierwszy PDF {#最短でpdfを作る}

1. Otwórz [aplikację internetową](/app/) i zaloguj się metodą wskazaną przez administratora.
2. Wybierz plik `.tex` i kliknij **Konwertuj do PDF**. Jeśli dokument korzysta z ilustracji lub bibliografii, spakuj te pliki wraz z dokumentem do archiwum ZIP i wybierz archiwum.
3. Otwórz PDF na stronie wyników. Później znajdziesz go w sekcji **Historia** aplikacji internetowej.

Jeśli nie masz dokumentu testowego, zapisz poniższy przykład jako `main.tex` w kodowaniu UTF-8.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Przykład z tekstem japońskim i układ plików ZIP](/pl/docs/projects/)
- [Instrukcja aplikacji internetowej](/pl/docs/web/)
- [Zapisywanie PDF i PNG oraz ponawianie wyodrębniania SVG](/pl/docs/outputs/)

Aby pracować w terminalu, [zainstaluj CLI dla swojego systemu](/pl/docs/client/). Skonfiguruj połączenie poleceniem `n624-latex setup`. W katalogu, w którym zapisano `main.tex`, wykonaj `n624-latex main.tex`, aby utworzyć `main.pdf`.

## Wybierz sposób pracy {#利用方法を選ぶ}

| Cel | Narzędzie | Instrukcja |
| --- | --- | --- |
| **Konwersja dokumentów w przeglądarce** | Aplikacja internetowa | [Konwersja w przeglądarce](/pl/docs/web/) |
| **Konwersja w terminalu i zapis wyników na komputerze** | CLI dla Windows, macOS lub Linux | [Instalacja CLI](/pl/docs/client/) |
| **Konwersja z ChatGPT lub Claude** | Remote MCP z OAuth | [Podłączanie ChatGPT lub Claude](/pl/docs/mcp/) |
| **Praca nad lokalnymi dokumentami w Codex lub Claude Code** | CLI, Local MCP i umiejętność | [Korzystanie z Codex lub Claude Code](/pl/docs/integrations/) |
| **Automatyzacja konwersji we własnej aplikacji** | API HTTP | [Publiczne API](/pl/docs/api/) |
| **Uruchomienie usługi na własnym serwerze Linux** | Własny serwer | [Administrowanie własnym serwerem](/pl/docs/self-hosting/) |

## Wymagania {#必要なもの}

- **Aplikacja internetowa i Remote MCP.** Potrzebujesz konta z metodą logowania wskazaną przez administratora serwera.
- **CLI, Local MCP i API HTTP.** Poproś administratora o klucz API renderowania z prefiksem `lrk_`.
- **Wymagania CLI zależnie od sposobu instalacji**
  - Debian i Ubuntu z APT: pakiet zawiera własną wersję Node.js.
  - macOS z Homebrew: wymaganą wersję Node.js instaluje Homebrew.
  - Instalator do pobrania dla Windows, macOS lub Linux: wymagany Node.js w wersji co najmniej 24.

Dokumenty kompiluje serwer. Żadna z tych metod nie wymaga lokalnej instalacji TeX Live.

> [!WARNING]
> Nie umieszczaj kluczy API w rozmowach z AI, kodzie źródłowym, repozytoriach Git ani dziennikach. Jeśli podejrzewasz wyciek klucza, natychmiast poproś administratora o jego unieważnienie i wydanie nowego.

W razie problemów z logowaniem lub konwersją zobacz [rozwiązywanie problemów](/pl/docs/troubleshooting/).
