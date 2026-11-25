---
slug: cli
category: CLI
title: Converter documentos e baixar resultados com a CLI
description: Compile TeX no terminal e baixe o PDF, o registro e as prévias.
navOrder: 30
updated: "2026-11-22"
since: "v1.0.0"
---

No diretório que contém `main.tex`, execute `n624-latex main.tex` para salvar o PDF nesse mesmo diretório. No primeiro uso, [instale a CLI](/pt/docs/client/) e configure a conexão.

## Autenticação {#認証}

Abra a tela de configuração em um navegador para salvar a chave de API.

```sh
n624-latex setup --gui
```

Se não puder abrir o navegador, por exemplo em uma sessão SSH, registre a chave pela **entrada padrão** para que ela não apareça nos argumentos do comando. No Bash ou Zsh, execute a primeira linha, cole a chave, pressione Enter e execute as linhas seguintes.

```sh
read -rs render_key
printf '%s' "$render_key" | n624-latex auth login --api-key-stdin
unset render_key
```

No Windows, você também pode usar a [entrada oculta do instalador](/pt/docs/windows/#インストール).

Os comandos abaixo verificam se há uma chave salva e removem a chave, respectivamente.

```sh
n624-latex auth status
n624-latex auth logout
```

- A variável de ambiente `LATEX_RENDER_API_KEY`, se definida, tem prioridade sobre a chave local.
- `logout` remove apenas a chave salva localmente. Quando necessário, desative a variável de ambiente ou revogue a chave no servidor separadamente.

### Escolher o servidor {#接続先サーバー}

Por padrão, a CLI se conecta ao serviço hospedado (`https://latex-render.n624.jp`). Para usar seu próprio servidor, configure a URL HTTPS na sessão do terminal em que executará os comandos.

- Omita os sufixos `/app/` e `/api/v1/` na URL.
- Use uma chave de API emitida por esse servidor.

**Linux / macOS**

```sh
export LATEX_RENDER_BASE_URL=https://latex.example.com
```

**Windows PowerShell**

```powershell
$env:LATEX_RENDER_BASE_URL = 'https://latex.example.com'
```

## Configuração e diagnóstico {#セットアップと診断}

Abra a configuração da conexão e das integrações com `n624-latex setup`. Se a conexão falhar, verifique primeiro o estado com os comandos abaixo. Se `n624-latex` não for encontrado, consulte [Instalação e PATH](/pt/docs/troubleshooting/#インストール-ログイン).

```sh
n624-latex setup status
n624-latex doctor
```

`doctor` inspeciona a instalação e as credenciais em modo somente leitura e omite o valor da chave de API. Se encontrar problemas, retorna o código de saída `2`.

| Instalação | Atualização e reparo |
| --- | --- |
| APT | [Atualize com APT](/pt/docs/client/#apt-版の更新) ou [reinstale](/pt/docs/client/#状態確認と修復) os pacotes danificados. [Registre o Local MCP manualmente](/pt/docs/mcp/#local-mcpの登録). |
| Homebrew | [Atualize com Homebrew](/pt/docs/client/#homebrew-版の更新) ou [reinstale](/pt/docs/client/#状態確認と修復) os pacotes danificados. Configure as integrações de IA com `n624-latex setup`. |
| Instalador para download | [Atualize pela configuração](/pt/docs/client/#配布インストーラー版の更新). Repare as integrações e os inicializadores gerenciados com `n624-latex setup repair`. |

Para desinstalar, siga as [instruções do método usado](/pt/docs/client/#アンインストール). A interface de configuração é local e fecha quando a CLI termina.

## Renderização {#レンダリング}

### Converter um arquivo TeX diretamente {#tex-ファイルを直接変換する}

Informe o arquivo `.tex` no diretório do projeto para gerar o PDF. Use caminhos relativos para referenciar imagens, bibliografia e arquivos `.sty` locais.

```sh
n624-latex main.tex
n624-latex chapters/report.tex -o build/report.pdf
```

- Se omitir `-o`, o PDF será salvo no diretório de execução do comando com o mesmo nome-base, por exemplo `main.pdf`.
- Se o LaTeX falhar, serão exibidos o arquivo, a linha e o ID do trabalho que puderem ser identificados. Uma falha de compilação ou download preserva o último PDF salvo com sucesso.

#### Escolher o motor LaTeX {#latex-のエンジンを選ぶ}

Para usar XeLaTeX, escreva o nome do motor antes do arquivo.

```sh
n624-latex xelatex main.tex
```

Se você omitir o motor, a CLI procura no início do documento `% !TeX program = xelatex` ou
`% !TEX TS-program = xelatex`. Na ausência dessas diretivas, consulta
`.n624-latex.json` na raiz do projeto. Você pode compartilhar esse arquivo
no Git para usar o mesmo motor em outros computadores.

```json
{"engine":"xelatex"}
```

Se nenhum motor for especificado, o padrão é LuaLaTeX. pLaTeX e upLaTeX exigem
que o ambiente de execução do servidor inclua a coleção de japonês.

| Motor | O que verificar ao migrar um documento |
| --- | --- |
| LuaLaTeX | Confira a configuração dos documentos que usam `fontspec` ou LuaTeX-ja. |
| pdfLaTeX | Sem suporte a `fontspec`. Use a configuração de fontes do pdfLaTeX. |
| XeLaTeX | Aceita `fontspec`. Verifique se existem pacotes exclusivos do LuaTeX. |
| pLaTeX / upLaTeX | Use uma classe de documento japonesa compatível com o motor. Para `jsarticle` no upLaTeX, especifique a opção de classe `uplatex`. |

O processamento da bibliografia depende dos pacotes e da configuração do documento. Inclua os arquivos `.bib` e os arquivos `.bst` personalizados. Documentos BibTeX com pLaTeX usam pBibTeX, e aqueles com upLaTeX usam upBibTeX. Consulte no [ambiente de renderização](/app/environment/) as verificações de PDF, SVG e posicionamento dos SVGs.

### Converter um ZIP ou solicitar vários formatos {#zip-複数の出力を指定する}

Use o subcomando `render` para converter um ZIP ou baixar todas as saídas, incluindo registros, prévias e SVGs.

```sh
n624-latex render [directory-or-zip] [--entrypoint main.tex] [--output .render] [--open] [--svg]
```

**Exemplos**

```sh
# Compile main.tex in the current directory and open the completed PDF
n624-latex render . --open

# Choose the main document in a ZIP and generate both PDF and SVG
n624-latex render ./report.zip --entrypoint reports/report.tex --output .render/report --svg
```

- O caminho padrão é o diretório atual e o valor padrão de `--entrypoint` é `main.tex`. A CLI prepara uma entrada de até 500 arquivos e aguarda o término. O ponto de entrada pode ser um caminho relativo até um arquivo `.tex`. O servidor verifica se o caminho é seguro e se o arquivo existe.
- Com `--svg`, as expressões matemáticas mais externas e os diagramas TikZ de nível superior também são extraídos como SVGs separados.

### Reutilizar a entrada em vários documentos {#同じ入力から複数の文書を作る-source-の再利用}

Se um diretório ou ZIP tiver vários documentos principais, envie a entrada uma vez com `source upload` e reutilize o ID. Use um diretório de saída (`--output`) diferente para cada trabalho.

```sh
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint reports/a.tex --output .render/a
n624-latex render --source source_... --entrypoint reports/b.tex --output .render/b
```

> [!DETAILS] Limpeza do destino, exclusões e envios duplicados
>
> - **Limpeza de saídas anteriores.** Ao reutilizar um destino, são removidos somente PDFs, prévias e SVGs que constavam no `job.json` anterior e estão ausentes do novo resultado. Os arquivos do usuário alheios ao trabalho são preservados.
> - **Verificação do destino.** Caminhos com links simbólicos são rejeitados. Em sistemas POSIX, também são verificados o proprietário e as permissões de gravação do grupo e de outros usuários. No Windows, a verificação dos bits de modo POSIX é ignorada.
> - **Exclusão do diretório de saída.** Se `--output` apontar para um subdiretório do projeto, somente esse diretório será excluído do ZIP seguinte. Diretórios com nomes parecidos continuam incluídos. A raiz do projeto não pode ser o destino.
> - **Envios duplicados.** Se o servidor mantiver um ZIP válido com o mesmo proprietário e SHA-256, retornará `uploadRequired: false` e dispensará a transferência. Somente esse proprietário poderá usar o ID da entrada em outros trabalhos.

## Projetos e revisões salvos {#保存projectと改訂}

Use a CLI para gerenciar e recompilar projetos e revisões do servidor. A web, a API, o MCP e outras chaves do mesmo usuário compartilham os projetos. As operações temporárias `render` e `source upload` dispensam salvar o projeto.

```sh
n624-latex projects list
n624-latex projects create <name>
n624-latex projects save <projectId> ./project --entrypoint main.tex --name <revision-name>
n624-latex projects get <projectId>
n624-latex projects jobs <projectId> <revisionId>
n624-latex projects render <projectId> <revisionId>
n624-latex projects rename <projectId> <name>
n624-latex projects delete <projectId> --yes
```

- **`save`** prepara um diretório ou ZIP como entrada e salva uma revisão imutável no projeto. Com `--svg`, a saída inicial da revisão é PDF e SVG.
- **`render`** cria um trabalho a partir de uma revisão salva. Somente `--svg` substitui a configuração de saída.
- **`list`, `get` e `jobs`** aceitam `--cursor` para obter a página seguinte.
- **`delete`** oculta o projeto na lista. Os trabalhos existentes não são removidos imediatamente.

## Operações com trabalhos {#ジョブ操作}

```sh
n624-latex jobs get <jobId>
n624-latex jobs cancel <jobId>
n624-latex jobs download <jobId> --output .render
n624-latex jobs download <jobId> --pdf-only --output .render
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
n624-latex jobs retry-svg <jobId> --output .render
n624-latex jobs delete <jobId> --yes
```

- **Baixar e aguardar.** Estes comandos usam a chave de API para renovar um token de curta duração. `jobs download` aguarda a conclusão do trabalho antes de substituir o conjunto salvo. Se a espera falhar ou for interrompida, o conjunto anterior é preservado. `delete` aplica-se apenas a trabalhos concluídos.
- **Obter mais prévias PNG.** Inicialmente, só a primeira página é gerada. O download normal busca os PNGs já gerados. Use, por exemplo, `--preview-page 2 5` para gerar essas páginas, verificar o tamanho e o SHA-256 e salvá-las. Isso não recompila o PDF nem prolonga a retenção.
- **Baixar o PDF antecipadamente e repetir o SVG.** Em trabalhos PDF e SVG, use `--pdf-only` para obter o PDF sem aguardar o SVG. Se apenas a etapa SVG falhar, o PDF é preservado e o resultado é parcial. `retry-svg` repete somente a extração. São permitidas 8 tentativas incluindo a inicial, sem prolongar a retenção. Se o ambiente de execução mudou, crie outro trabalho. Consulte [Disponibilidade do PDF e nova tentativa de SVG](/pt/docs/api/#pdfの先行公開とsvgの再試行).
- **Novas tentativas por problemas de rede.** Falhas transitórias na consulta do estado são repetidas automaticamente. Erros de autenticação e permissão são retornados de imediato. Se a CLI parar de aguardar, o servidor poderá continuar processando. Consulte o mesmo `<jobId>` antes de criar outro trabalho. Veja [Espera e novas tentativas na CLI](/pt/docs/reference/#cliの待機と再試行).

## Arquivos de saída {#成果物}

Para baixar o PDF antecipadamente, escolher páginas PNG ou repetir a extração de SVG, consulte [Obter PDF, PNG e SVG](/pt/docs/outputs/).

| Caminho | Conteúdo |
| --- | --- |
| `.render/result.pdf` | PDF gerado com sucesso |
| `.render/compile.log` | Registro de compilação do LaTeX |
| `.render/errors.json` | Detalhes estruturados dos erros |
| `.render/job.json` | Estado final do trabalho |
| `.render/previews/page-N.png` | Prévias de até 100 páginas |
| `.render/svg/manifest.json` | Correspondência entre SVGs, posições no arquivo-fonte e coordenadas do PDF |
| `.render/svg/objects/*.svg` | SVG individual por expressão matemática ou diagrama TikZ |

## Saída JSON {#json出力}

Adicione `--json` a qualquer comando para gravar um único objeto JSON na saída padrão, sem mensagens de progresso. A apresentação normal e o JSON usam o mesmo resultado de `client-core` e omitem chaves de API e tokens de curta duração.

```sh
n624-latex auth status --json
n624-latex render . --json
n624-latex source upload ./project.zip --json
n624-latex render --source source_... --entrypoint report.tex --output .render/report --json
n624-latex jobs get <jobId> --json
n624-latex jobs download <jobId> --output .render --json
n624-latex doctor --json
```

Consulte o [formato JSON da CLI](/pt/docs/reference/#cliのjson形式) para os esquemas de sucesso e erro e os códigos de saída.
