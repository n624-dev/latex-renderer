---
slug: windows
category: Установка
title: Установка CLI в Windows
description: Установите CLI из PowerShell, зарегистрируйте ключ API и создайте PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Установка {#インストール}

1. Подготовьте **Node.js версии 24 или новее** и выданный администратором ключ API (`lrk_...`).
2. Откройте PowerShell под своей обычной учётной записью и выполните команды.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Вставьте ключ в скрытое поле ввода. Windows зашифрует его и сохранит для текущего пользователя.
4. После установки откройте **новое окно PowerShell**. Если вы [используете собственный сервер](/ru/docs/cli/#接続先サーバー), укажите его адрес перед преобразованием.

Чтобы заново зарегистрировать ключ, откройте настройки командой `n624-latex setup`.

## Первое преобразование {#最初の変換}

1. В Проводнике откройте папку с файлом `main.tex`. Можно использовать [пример документа](/ru/docs/#最短でpdfを作る).
2. Введите `powershell` в адресной строке Проводника и нажмите Enter. В открывшемся окне PowerShell выполните команду.

```powershell
n624-latex main.tex
```

В той же папке появится `main.pdf`. Для работы с ZIP и скачивания нескольких файлов см. [Преобразование с помощью CLI](/ru/docs/cli/#レンダリング).

## Обновление {#更新}

Выполните `n624-latex setup` в PowerShell и обновите клиент на экране настроек.

> [!DETAILS] 履歴資料　Переход с версии 1.6.9 или более ранней
>
> Запустите установщик из [инструкций по установке](#インストール) с `-SkipCredential`. Сохранённый ключ останется на месте, будет добавлена команда `n624-latex`. Если вы меняли каталог установки, [укажите тот же путь](/ru/docs/reference/#windowsの配置と保護). В существующих скриптах по-прежнему можно использовать `latex-render`.

## Удаление только ключа API {#apiキーだけを削除}

Чтобы оставить клиент и удалить только сохранённый ключ, выполните команду.

```powershell
n624-latex auth logout
```

## Удаление {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

По умолчанию удаляются клиент, сохранённый ключ API и управляемые навыки для Codex и Claude. Чтобы оставить учётные данные или навыки, добавьте соответственно `-KeepCredential` или `-KeepSkills`.
