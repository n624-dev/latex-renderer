---
slug: projects
category: Projetos
title: Preparar arquivos TeX e ZIP
description: Selecione os arquivos de entrada, confira os limites e teste um projeto mínimo de LuaLaTeX.
navOrder: 50
updated: "2026-11-22"
since: "v1.0.0"
---

## Estrutura do projeto {#構成}

- **Documento com um arquivo.** Envie o `.tex` diretamente pelo aplicativo web ou execute `n624-latex main.tex` pela CLI.
- **Documento com imagens, bibliografia ou fontes divididas.** Reúna tudo em **um ZIP**, preservando os caminhos relativos. A CLI também aceita a pasta diretamente.
- **Como criar o ZIP.** Selecione o conteúdo da pasta, como `main.tex` e `images/`, ao compactar. Se incluir a pasta superior, informe um ponto de entrada como `project/main.tex` na conversão.

```text
project/
├─ main.tex
├─ references.bib
├─ images/
│  └─ figure.png
└─ styles/
   └─ local.sty
```

**Ponto de entrada e caminhos relativos**
O ponto de entrada padrão é `main.tex` na raiz do projeto. Mesmo quando você escolhe um `.tex` em uma subpasta, por exemplo `docs/main.tex`, **o diretório de trabalho da compilação é sempre a raiz do projeto**. Para incluir em `docs/main.tex` o arquivo `body.tex` da mesma pasta, escreva `\input{docs/body.tex}`. Se escrever `\input{body.tex}`, o compilador procurará `body.tex` na raiz.

## Exemplo mínimo em japonês {#日本語の最小例}

O mecanismo padrão é **LuaLaTeX**. Para testar um documento com japonês, salve o exemplo abaixo como `main.tex` em UTF-8.

```latex
\documentclass{ltjsarticle}
\begin{document}
日本語とEnglishを含む文書です。
\end{document}
```

Pesquise os pacotes e fontes disponíveis no [ambiente de renderização](/app/environment/). A lista é obtida do contêiner real durante o deploy e também é usada pelas pesquisas do Remote MCP. Se faltar algum pacote, envie ao administrador a mensagem correspondente de `compile.log`.

## Projetos e revisões salvos {#保存projectと改訂}

Os documentos convertidos na aplicação web (`/app/`) são salvos em projetos.

- **Registro automático.** Uma combinação nova de conteúdo, documento principal, mecanismo e formatos de saída gera uma revisão. As anteriores ficam no histórico.
- **Converter uma revisão anterior.** Selecione **Converter novamente** para usar o documento e o mecanismo salvos. Alterar a saída nessa etapa adiciona um resultado ao histórico da mesma revisão.
- **Compartilhar e excluir.** O aplicativo web, a CLI, a API HTTP e o MCP compartilham os projetos e revisões do mesmo usuário. Excluir um projeto oculta o registro. Entradas e resultados existentes são removidos conforme seus prazos de retenção. Se precisar de exclusão completa imediata, contate o administrador. Entradas referenciadas por revisões ativas contam para a cota de armazenamento. Consulte [Compartilhamento e retenção](/pt/docs/reference/#保存プロジェクトの共有-保持).

### Editar no navegador {#ブラウザーで編集する}

Abra um projeto salvo e escolha **Editar TeX**. As alterações são salvas automaticamente no rascunho. Quando você para de digitar, o editor inicia a compilação e atualiza o PDF em caso de sucesso. Se a prévia falhar, é possível consultar o último PDF exibido e a versão correspondente.

Novos projetos começam com um `main.tex` vazio. Enquanto o documento estiver vazio, você pode escolher um modelo. Para retomar uma versão salva, selecione **Editar a partir desta revisão**. Se já houver um rascunho, confirme antes de substituí-lo.

Para compilar sob demanda, desative **Compilação automática** e clique em **Compilar**. Selecione **Saídas da versão salva** e clique em **Salvar uma versão** para guardar o rascunho atual e as opções de saída. Para obter SVG, abra a revisão salva e clique em **Converter novamente**.
Acompanhe a compilação e as prévias no próprio editor.

## Arquivos excluídos do envio {#送信から除外されるもの}

- **Exclusões automáticas.** A CLI exclui `.git`, `.render` e arquivos auxiliares do LaTeX como `.aux`. Links simbólicos são rejeitados.
- **Arquivos incompatíveis.** Mova pastas desnecessárias como `node_modules` para fora do projeto. Ao enviar uma pasta, a CLI mostra o caminho e para se encontrar uma extensão não aceita. Para manter um arquivo como `README.md` no projeto sem enviá-lo, adicione ao `.latexrenderignore` da raiz uma linha com `README.md`. O servidor verifica as mesmas extensões no ZIP recebido.
- **Extensões aceitas** (sem distinção entre maiúsculas e minúsculas)
  `.tex`, `.sty`, `.cls`, `.bib`, `.bst`, `.csv`, `.dat`, `.txt`, `.png`, `.jpg`, `.jpeg`, `.pdf`
  Um arquivo `.bst` é um estilo de bibliografia BibTeX e pode ficar em uma subpasta. Se um estilo próprio usar uma extensão fora da lista, consulte o administrador antes de alterar a extensão.

## Limites {#制限}

- **Quantidade.** No máximo 500 arquivos.
- **Tamanhos padrão.** 20 MiB por ZIP enviado, 100 MiB no total após a extração e 20 MiB por arquivo.
- **Ponto de entrada.** Caminho relativo de um `.tex` na entrada. O padrão é `main.tex` na raiz.
- **Segurança.** O acesso ao shell a partir do TeX (incluindo `\write18`), a execução de comandos externos e as conexões externas estão desativados.
- **Recursos.** Aplicam-se os limites de tempo, armazenamento por usuário e retenção definidos pelo administrador.
