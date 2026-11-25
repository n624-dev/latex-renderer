---
slug: index
category: Primeiros passos
title: Guia do LaTeX Renderer
description: Converta documentos LaTeX em PDF no navegador, no terminal ou com um assistente de IA.
navOrder: 10
updated: "2026-11-22"
since: "v1.0.0"
---

## Crie seu primeiro PDF {#最短でpdfを作る}

1. Abra o [aplicativo web](/app/) e entre pelo método indicado pelo administrador.
2. Selecione o arquivo `.tex` e clique em **Converter para PDF**. Se o documento usa imagens ou bibliografia, inclua tudo em um ZIP e selecione esse arquivo.
3. Abra o PDF na página de resultados. Para consultá-lo mais tarde, abra o **Histórico** no aplicativo web.

Se precisar de um documento para testar, salve este exemplo como `main.tex` com codificação UTF-8.

```latex
\documentclass{article}
\begin{document}
Hello, LaTeX!
\end{document}
```

- [Exemplo em japonês e organização do ZIP](/pt/docs/projects/)
- [Guia do aplicativo web](/pt/docs/web/)
- [Salvar PDF e PNG e repetir a extração de SVG](/pt/docs/outputs/)

Para usar o terminal, [instale a CLI para o seu sistema](/pt/docs/client/). Configure a conexão com `n624-latex setup`. Na pasta que contém `main.tex`, execute `n624-latex main.tex` para criar `main.pdf`.

## Escolha como usar o serviço {#利用方法を選ぶ}

| O que você quer fazer | Ferramenta | Guia |
| --- | --- | --- |
| **Converter pelo navegador** | Aplicativo web | [Converter no navegador](/pt/docs/web/) |
| **Converter no terminal e salvar no computador** | CLI para Windows, macOS ou Linux | [Instalar a CLI](/pt/docs/client/) |
| **Converter no ChatGPT ou Claude** | Remote MCP com OAuth | [Conectar o ChatGPT ou o Claude](/pt/docs/mcp/) |
| **Trabalhar com arquivos locais no Codex ou Claude Code** | CLI, Local MCP e skill | [Usar o Codex ou Claude Code](/pt/docs/integrations/) |
| **Automatizar conversões em um aplicativo próprio** | API HTTP | [API pública](/pt/docs/api/) |
| **Operar o serviço em um servidor Linux próprio** | Hospedagem própria | [Administrar seu servidor](/pt/docs/self-hosting/) |

## O que é necessário {#必要なもの}

- **Aplicativo web e Remote MCP.** Use a conta de acesso indicada pelo administrador do servidor.
- **CLI, Local MCP e API HTTP.** Peça ao administrador uma chave de API de renderização que comece com `lrk_`.
- **Requisitos da CLI por método de instalação**
  - Debian e Ubuntu com APT: o pacote inclui uma cópia própria do Node.js.
  - macOS com Homebrew: o Homebrew instala o Node.js necessário.
  - Instalador para Windows, macOS ou Linux: é necessário ter Node.js 24 ou posterior.

O servidor executa toda a compilação. Nenhum desses métodos exige instalar o TeX Live no seu computador.

> [!WARNING]
> Não cole chaves de API em conversas com IA, código-fonte, repositórios Git ou logs. Se suspeitar de um vazamento, peça imediatamente ao administrador para revogar a chave e emitir outra.

Se tiver problemas para entrar ou converter, consulte o [guia de solução de problemas](/pt/docs/troubleshooting/).
