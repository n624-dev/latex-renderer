---
slug: web
category: Aplicativo web
title: Converter documentos no navegador
description: Crie um PDF a partir de um arquivo TeX ou ZIP e consulte resultados atuais e anteriores.
navOrder: 12
updated: "2026-11-22"
since: "v1.0.0"
---

## Converter arquivos em PDF {#ブラウザでpdfへ変換}

1. Abra o [aplicativo web](/app/) e entre pelo método indicado pelo administrador.
2. Selecione os arquivos ou arraste-os para a página.
   - Para um documento de arquivo único, selecione diretamente o `.tex`.
   - Se houver imagens, bibliografias ou vários arquivos `.tex` (por exemplo, com `\input`), reúna todas as dependências em um único `.zip`. Consulte os [arquivos aceitos e a estrutura do ZIP](/pt/docs/projects/).
   - Ao selecionar vários arquivos `.tex` individualmente, cada um é convertido como documento independente.
3. Se o ZIP contiver vários arquivos `.tex` e o aplicativo solicitar uma escolha, selecione o documento principal como ponto de entrada.
4. Clique em **Converter para PDF**. Ao terminar, a página de resultados exibe o PDF e as prévias das páginas.

Para usar outro mecanismo além do LuaLaTeX, abra **Destino e opções de saída** e selecione **Motor**. O [ambiente de renderização](/app/environment/) mostra os mecanismos disponíveis e a verificação de PDF, SVG e posicionamento dos SVGs. O pLaTeX e o upLaTeX exigem a coleção de japonês no servidor.

## Editar no navegador {#ブラウザーで文書を編集する}

1. Abra o documento em [Projetos](/app/projects/) e clique em **Editar TeX**. Um projeto novo começa com um `main.tex` vazio e permite escolher um modelo.
2. As alterações são salvas automaticamente no rascunho. Use **Anexar arquivo** para adicionar imagens e bibliografias.
3. Com **Compilação automática** ativada, o PDF é atualizado quando você para de digitar. Clique em **Compilar** para atualizá-lo imediatamente.
4. Clique em **Salvar uma versão** para guardar a entrada no histórico. Escolha **Editar a partir desta revisão** para continuar de uma versão anterior. Se houver um rascunho, o editor pede confirmação antes de substituí-lo.

Abra **Gerir ficheiros** para adicionar ou anexar ficheiros. Em **Definições**, pode alterar o motor, a compilação automática e o idioma, ou guardar uma revisão. O botão **⋯** no painel do PDF abre as opções de ampliação e PNG.

Se a compilação falhar, o rascunho e o último PDF gerado com sucesso são preservados. Clique em um erro com arquivo e número de linha para ir ao trecho correspondente. No celular, alterne entre **Código**, **PDF** e **Erros**. Se o PDF demorar para aparecer, use **PNG (visualização leve)**.

As prévias temporárias ficam apenas no editor. Para guardar o PDF para uso posterior, clique em **Salvar PDF**.

O editor usa UTF-8. Para arquivos Shift_JIS ou EUC-JP, abra-os em um editor de texto com a codificação original, confira a exibição e salve uma cópia em UTF-8. Anexe a cópia com o mesmo nome e confirme a substituição.

## Exportar fórmulas e diagramas TikZ como SVG {#数式や-tikz-を-svg-で取得する}

1. Antes da conversão, abra **Destino e opções de saída** e marque **Exportar também equações e TikZ como SVG**.
2. O PDF pode ser baixado assim que estiver pronto.
3. Se o resultado indicar **Sucesso parcial**, o PDF foi concluído, mas a extração de SVG falhou. Salve primeiro o PDF e, se necessário, clique em **Tentar novamente apenas SVG**.

Inicialmente só é gerada a prévia PNG da primeira página. As seguintes são geradas quando você as abre. O PDF final pode ser baixado enquanto as prévias estão sendo preparadas. Consulte [Obter PDF, PNG e SVG](/pt/docs/outputs/).

## Abrir documentos e resultados anteriores {#以前の文書や結果を開く}

- **[Histórico](/app/history/)** mostra o andamento e os arquivos gerados. É possível reabrir a mesma página de resultados depois de fechar o navegador.
- **[Projetos](/app/projects/)** lista documentos e revisões salvos. Para converter com uma entrada anterior, abra a revisão e selecione **Converter novamente**.
- Em **[Ambiente de renderização](/app/environment/)**, pesquise os pacotes LaTeX e as fontes disponíveis no servidor.

## Informações públicas e restritas {#公開される情報}

- **Páginas com acesso autenticado.** Entre no aplicativo web (`/app/`) para consultar seus documentos e resultados no histórico ou nas páginas de resultados. A administração (`/admin/`) é exclusiva de administradores e proprietários. Consulte [Segurança da conta e dos documentos](/pt/docs/security/).
- **Páginas públicas.** Se não conseguir entrar, consulte o [estado do serviço](/status/) ou a [solução de problemas](/pt/docs/troubleshooting/). A CLI está em [Downloads](/downloads/) e as especificações de integração, na [API pública](/pt/docs/api/).
