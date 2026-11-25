---
slug: contributing
category: Desenvolvimento e contribuições
title: Contribuir com a documentação
description: Edite as guias em Markdown e verifique suas alterações localmente.
navOrder: 80
updated: "2026-11-22"
since: "v1.0.0"
---

## Editar uma guia {#本文を編集する}

- **Informar um erro.** Se uma instrução divergir da interface ou dos comandos, indique a página e a correção sugerida no [GitHub Issues](https://github.com/n624-dev/latex-renderer/issues/new/choose).
- **Enviar um pull request.** Edite o arquivo correspondente nos [originais Markdown da documentação pública (`docs/public/`)](https://github.com/n624-dev/latex-renderer/tree/main/docs/public) e abra um pull request.

## Verificação local {#ローカル検証}

Após editar, execute os comandos abaixo e confira se a compilação e as verificações de links e cabeçalhos passam.

```bash
pnpm install --frozen-lockfile
pnpm --filter @latex-renderer/web... build
pnpm --filter @latex-renderer/public-web build
pnpm check
```

A compilação de `public-web` faz uma simulação com Wrangler e inicia um runtime local de Workers para verificar páginas representativas, índice de pesquisa, respostas 404, redirecionamentos e cabeçalhos.

## Compatibilidade {#互換性}

- Preserve caminhos públicos e âncoras de títulos (fragmentos `#...` gerados pelo texto do título). Se renomear um título, verifique os links que levam a ele.
- Ao alterar opções de CLI ou exemplos de requisições HTTP, confirme que correspondem à implementação e às definições OpenAPI.
