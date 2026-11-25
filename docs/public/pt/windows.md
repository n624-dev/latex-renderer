---
slug: windows
category: Instalação
title: Instalar a CLI no Windows
description: Use o PowerShell para instalar a CLI, registrar uma chave de API e gerar um PDF.
navOrder: 20
updated: "2026-11-22"
since: "v1.0.0"
---

## Instalação {#インストール}

1. Prepare o **Node.js 24 ou posterior** e uma chave de API (`lrk_...`) fornecida pelo administrador do servidor.
2. Abra o PowerShell com sua conta habitual e execute estes comandos.

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/install.ps1 -OutFile $env:TEMP\install-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\install-latex-renderer.ps1
```

3. Cole a chave no campo de entrada oculto. O Windows a criptografa para uso exclusivo do usuário atual.
4. Quando terminar, abra uma **nova janela do PowerShell**. Se [usar um servidor próprio](/pt/docs/cli/#接続先サーバー), defina o endereço antes de converter.

Para registrar outra chave mais tarde, abra a configuração com `n624-latex setup`.

## Primeira conversão {#最初の変換}

1. No Explorador de Arquivos, abra a pasta que contém `main.tex`. Você pode usar o [documento de exemplo](/pt/docs/#最短でpdfを作る).
2. Digite `powershell` na barra de endereços do Explorador e pressione Enter. Na janela do PowerShell, execute o comando a seguir.

```powershell
n624-latex main.tex
```

O arquivo `main.pdf` é criado na mesma pasta. Para trabalhar com ZIP ou vários arquivos de saída, consulte a [conversão pela CLI](/pt/docs/cli/#レンダリング).

## Atualização {#更新}

Execute `n624-latex setup` no PowerShell e atualize pela tela de configuração.

> [!DETAILS] 履歴資料　Migrar da versão v1.6.9 ou anterior
>
> Execute o mesmo instalador indicado nas [instruções de instalação](#インストール) com `-SkipCredential`. Ele preserva a chave salva e adiciona `n624-latex`. Se escolheu outra pasta de instalação, [especifique a mesma pasta](/pt/docs/reference/#windowsの配置と保護). Scripts existentes podem continuar usando `latex-render`.

## Remover apenas a chave de API {#apiキーだけを削除}

Para manter o cliente instalado e apagar apenas a chave salva, execute este comando.

```powershell
n624-latex auth logout
```

## Desinstalação {#アンインストール}

```powershell
Invoke-WebRequest https://latex-render.n624.jp/downloads/windows/uninstall.ps1 -OutFile $env:TEMP\uninstall-latex-renderer.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File $env:TEMP\uninstall-latex-renderer.ps1
```

Por padrão são removidos o cliente, a chave salva e as skills gerenciadas do Codex e do Claude. Para manter a chave ou as skills, acrescente `-KeepCredential` ou `-KeepSkills`, respectivamente.
