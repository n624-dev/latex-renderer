---
slug: windows
category: Instalacja
title: Instalacja CLI w systemie Windows
description: Zainstaluj CLI z PowerShell, zarejestruj klucz API i utwórz PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Instalacja {#インストール}

1. Przygotuj **Node.js w wersji co najmniej 24** i klucz API (`lrk_...`) otrzymany od administratora.
2. Otwórz PowerShell na swoim zwykłym koncie i wykonaj poniższe polecenia.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Wklej klucz w ukrytym polu wprowadzania. Windows zaszyfruje go i zapisze dla bieżącego użytkownika.
4. Po instalacji otwórz **nowe okno PowerShell**. Jeśli [używasz własnego serwera](/pl/docs/cli/#接続先サーバー), podaj jego adres przed konwersją.

Aby ponownie zarejestrować klucz, otwórz ustawienia poleceniem `n624-latex setup`.

## Pierwsza konwersja {#最初の変換}

1. W Eksploratorze plików otwórz katalog zawierający `main.tex`. Możesz użyć [przykładowego dokumentu](/pl/docs/#最短でpdfを作る).
2. Wpisz `powershell` na pasku adresu Eksploratora i naciśnij Enter. W otwartym oknie PowerShell wykonaj polecenie.

```powershell
n624-latex main.tex
```

W tym samym katalogu powstanie `main.pdf`. Aby pracować z ZIP lub pobrać kilka plików, zobacz [instrukcję konwersji w CLI](/pl/docs/cli/#レンダリング).

## Aktualizacja {#更新}

Wykonaj `n624-latex setup` w PowerShell i zaktualizuj klienta na ekranie ustawień.

> [!DETAILS] 履歴資料　Migracja z wersji 1.6.9 lub wcześniejszej
>
> Uruchom ten sam instalator co w [instrukcji instalacji](#インストール) z opcją `-SkipCredential`. Zapisany klucz zostanie zachowany, a polecenie `n624-latex` dodane. Jeśli katalog instalacji został zmieniony, [wskaż to samo położenie](/pl/docs/reference/#windowsの配置と保護). Istniejące skrypty mogą nadal używać `latex-render`.

## Usuwanie tylko klucza API {#apiキーだけを削除}

Aby zachować klienta i usunąć tylko zapisany klucz, wykonaj polecenie.

```powershell
n624-latex auth logout
```

## Odinstalowanie {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Domyślnie usuwane są klient, zapisany klucz API i zarządzane umiejętności dla Codex i Claude. Aby zachować dane uwierzytelniające lub umiejętności, dodaj odpowiednio `-KeepCredential` lub `-KeepSkills`.
