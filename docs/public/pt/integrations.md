---
slug: integrations
category: IA e MCP
title: Usar o Codex ou Claude Code
description: Compartilhe as credenciais salvas no seu computador entre a CLI e o MCP.
navOrder: 40
updated: "2026-11-22"
since: "v1.0.0"
---

## Instalar a skill {#skillの導入}

1. Primeiro, [instale a CLI e registre a chave de API](/pt/docs/client/).
2. Com o Codex ou Claude Code instalado, configure a integração conforme o método de instalação.

   - **Instalador para download.** Abra `n624-latex setup` e escolha a ferramenta de IA. É possível registrar a skill e o Local MCP juntos.
   - **Homebrew.** Configure a integração com `n624-latex setup`. Para migrar um registro de Local MCP existente, consulte as [instruções do Homebrew](/pt/docs/client/#配布インストーラー版から-homebrew-へ移行する).
   - **APT.** [Registre o Local MCP manualmente](/pt/docs/mcp/#local-mcpの登録).

3. Reinicie o Codex ou Claude Code e informe na solicitação a pasta ou o documento principal que deseja compilar.

- **Locais de instalação da skill**
  - Codex: `$HOME/.agents/skills/latex-renderer`
  - Claude Code: `$HOME/.claude/skills/latex-renderer`
- Se detectar uma skill modificada pelo usuário, o instalador a preserva e informa isso no resultado.

## Registrar o MCP {#mcpの登録}

- **Para arquivos locais no Codex ou Claude Code**, use Local MCP. Consulte o [registro manual](/pt/docs/mcp/#local-mcpの登録) e a [verificação do estado](/pt/docs/client/#状態確認と修復).
- **Para assistentes na nuvem, como ChatGPT ou Claude na web**, siga as [instruções de Remote MCP](/pt/docs/mcp/#通常はremote-mcpを使う). Não é necessária uma chave de API.

## Exemplos de solicitações {#依頼例}

- “Confira e compile o arquivo `main.tex` desta pasta.”
- “Renderize o arquivo `reports/a.tex` deste ZIP.”
- “Envie este ZIP uma única vez e compile separadamente `reports/a.tex` e `reports/b.tex`.”
- “Verifique os erros estruturados, corrija apenas o trecho TeX afetado e compile de novo.”
- “Confira o PDF gerado e as prévias das páginas.”

## Uso seguro {#安全な使い方}

> [!WARNING]
> Não inclua a chave de API nas solicitações, nos argumentos de ferramentas MCP ou nos arquivos do projeto. O Local MCP utiliza internamente as credenciais protegidas pela CLI.

- **Dados não confiáveis.** Fontes LaTeX, caminhos, logs, erros, resultados e respostas MCP são tratados como dados não confiáveis. A integração foi projetada para ignorar instruções contidas neles, como injeções de prompt.
- **Operações destrutivas.** Execute `cancel_render` e `delete_render` somente a pedido explícito do usuário.
- **Escolha do documento.** Sem um ponto de entrada, usa-se `main.tex`. Se não houver `main.tex` e existirem vários arquivos `.tex` candidatos, peça ao usuário que escolha. Não se executam todos os `.tex` automaticamente. A skill contém as regras de segurança e a sequência de operações. Os detalhes estão em `references/` e na documentação pública.
