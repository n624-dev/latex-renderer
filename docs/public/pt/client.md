---
slug: client
category: Instalação
title: Instalar a CLI
description: Instale a CLI no Windows, macOS ou Linux e crie o primeiro PDF no terminal.
navOrder: 15
updated: "2026-11-22"
since: "v1.0.0"
---

## Plataformas compatíveis {#対応環境}

Instale pelo método adequado ao sistema e registre a chave de API (`lrk_...`) fornecida pelo administrador. Os documentos LaTeX são compilados no servidor.

| Plataforma | Instalação | Node.js |
| --- | --- | --- |
| Debian 12 / 13 ou Ubuntu 24.04 / 26.04 (amd64 ou arm64) | **[Pacote APT](#debian-ubuntu-の-apt-パッケージ)** | Incluído |
| Windows | **[Instruções para Windows](/pt/docs/windows/)** | 24 ou posterior |
| macOS (Apple Silicon ou Intel) | **[Homebrew](#homebrew-でインストール)** | Instalado pelo Homebrew |
| macOS ou outras distribuições Linux | **[Instalador para download](#linux-macos)** | 24 ou posterior |

## Instalar com APT no Debian ou Ubuntu {#debian-ubuntu-の-apt-パッケージ}

1. [Baixe `n624-latex.sources`](https://apt.n624.jp/latex-renderer/n624-latex.sources). O arquivo inclui a chave pública de assinatura do repositório APT do LaTeX Renderer.
2. Na pasta onde salvou o arquivo, execute os comandos abaixo.

```sh
sudo install -m 0644 n624-latex.sources /etc/apt/sources.list.d/n624-latex.sources
sudo apt update
sudo apt install n624-latex
```

3. Continue em [Criar o primeiro PDF](#最初の-pdf-を作る). Para montar um servidor, siga o [guia de hospedagem própria](/pt/docs/self-hosting/).

## Instalar com Homebrew {#homebrew-でインストール}

Execute os comandos abaixo em um Mac com Homebrew instalado.

```sh
brew install n624-dev/tap/n624-latex
n624-latex setup
```

Registre a chave de API e siga para [Criar o primeiro PDF](#最初の-pdf-を作る).

### Migrar da instalação por download para o Homebrew {#配布インストーラー版から-homebrew-へ移行する}

A chave de API salva e as configurações MCP continuam disponíveis. Use `type -a n624-latex` para ver qual comando o shell encontra primeiro. Se a versão anterior vier primeiro, execute a versão do Homebrew diretamente.

```sh
"$(brew --prefix)/bin/n624-latex" setup
```

Para usar a versão Homebrew no comando `n624-latex` habitual, ajuste o `PATH` do shell para que o `bin` do Homebrew venha antes da instalação antiga.

Para migrar também o Local MCP, altere o comando da entrada `latex-renderer` existente na ferramenta de IA para o caminho absoluto de `bin/latex-renderer-mcp` no Homebrew. Use `brew --prefix` para localizar o Homebrew.

Antes de remover a versão anterior, reinicie a ferramenta de IA e confirme a conexão ao Local MCP do Homebrew. Use o caminho absoluto do lançador antigo para remover a versão preservando a chave e as skills. Para uma instalação anterior no local padrão, execute o seguinte.

```sh
"$HOME/.local/bin/latex-render" setup remove --yes --keep-credential --keep-skills
```

## Preparar o instalador para download {#配布インストーラーの準備}

Instale o **Node.js 24 ou posterior** para seu usuário habitual e confirme com `node --version`. No Windows, siga as [instruções para Windows](/pt/docs/windows/).

## Linux e macOS {#linux-macos}

No terminal, baixe o instalador em uma pasta temporária e execute-o com Node.js.

```sh
installer_dir=$(mktemp -d) &&
  curl -fsSL https://latex-render.n624.jp/downloads/client/install.mjs -o "$installer_dir/install.mjs" &&
  node "$installer_dir/install.mjs"
```

Se `n624-latex` não for encontrado, abra um novo terminal. Se o problema persistir, execute `export PATH="$HOME/.local/bin:$PATH"` e adicione a mesma linha ao arquivo de configuração do shell, por exemplo `~/.bashrc` ou `~/.zshrc`.

## Criar o primeiro PDF {#最初の-pdf-を作る}

1. Abra a configuração com seu usuário habitual e salve a chave de API. Para hospedagem própria, primeiro [especifique o servidor](/pt/docs/cli/#接続先サーバー). Em ambientes sem navegador, [registre a chave pela entrada padrão](/pt/docs/cli/#認証).

```sh
n624-latex setup
```

2. Execute o comando abaixo na pasta de `main.tex`. Você pode usar o [documento de exemplo](/pt/docs/#最短でpdfを作る).

```sh
n624-latex main.tex
```

O arquivo `main.pdf` é criado na mesma pasta. Para definir o destino ou trabalhar com ZIP, PDF e SVG, consulte [Converter e baixar pela CLI](/pt/docs/cli/#レンダリング).

## Windows {#windows}

As [instruções para Windows](/pt/docs/windows/) usam PowerShell. O Windows DPAPI criptografa a chave salva para o usuário atual. Consulte [Alterar o local de instalação e reparar o PATH](/pt/docs/reference/#windowsの配置と保護).

## Atualizações {#更新}

### Atualizar o pacote APT {#apt-版の更新}

```sh
sudo apt update
sudo apt install --only-upgrade n624-latex
```

As configurações de conexão e a chave são preservadas. Para atualizar o próprio servidor, use a [tela de atualizações da administração](/pt/docs/updates/).

### Atualizar o pacote Homebrew {#homebrew-版の更新}

```sh
brew upgrade n624-dev/tap/n624-latex
```

### Atualizar uma instalação por download {#配布インストーラー版の更新}

Execute o seguinte comando ou repita o comando de instalação inicial.

```sh
n624-latex setup
```

> [!DETAILS] 履歴資料　Atualizar clientes v1.6.9 ou anteriores
>
> Em sistemas que só tenham `latex-render`, repita a instalação. [No Windows não é necessário redigitar a chave salva](/pt/docs/windows/#更新). No macOS e no Linux, você também pode atualizar com `latex-render setup` e adicionar o novo comando com `latex-render setup repair`. Scripts existentes podem continuar usando `latex-render`.

> [!DETAILS] Como funcionam a instalação e as atualizações
>
> - Se o SHA-256 do ZIP de distribuição coincidir com a versão instalada, o instalador verifica somente as configurações gerenciadas, sem substituir arquivos.
> - Ao atualizar, o instalador move a versão anterior para uma cópia de segurança datada. Outros lançadores, registros de MCP e skills modificadas pelo usuário são preservados.

## Verificar e reparar a instalação {#状態確認と修復}

Os comandos seguintes verificam o estado de qualquer método de instalação.

```sh
n624-latex setup status
n624-latex doctor --json
```

- No APT, reinstale o pacote com `sudo apt install --reinstall n624-latex`.
- No Homebrew, reinstale o pacote com `brew reinstall n624-dev/tap/n624-latex`.
- Para o instalador por download, repare os lançadores e integrações gerenciados com `n624-latex setup repair`.

## Salvar e recuperar resultados {#成果物の保存と復旧}

`n624-latex main.tex` salva o PDF na pasta atual. Para os PDFs, logs e imagens salvos por `render` e `jobs download`, consulte [Arquivos de saída da CLI](/pt/docs/cli/#成果物). Se o destino estiver em uso, consulte [Solução de problemas](/pt/docs/troubleshooting/#成果物の取得).

## Desinstalação {#アンインストール}

Remova o pacote APT com `sudo apt remove n624-latex`. Para excluir a chave do usuário, execute `n624-latex auth logout` antes de remover o pacote.

Remova o pacote Homebrew com `brew uninstall n624-dev/tap/n624-latex`. A chave salva e a configuração MCP da ferramenta de IA serão mantidas. Se não precisar delas, encerre a sessão antes de desinstalar e remova o registro MCP na ferramenta.

Para desinstalar a versão do instalador para download, execute este comando.

```sh
n624-latex setup remove --yes
```

Para preservar credenciais ou skills, use `--keep-credential` ou `--keep-skills`, respectivamente. Para remover com o script do Windows, consulte as [instruções para Windows](/pt/docs/windows/#アンインストール).
