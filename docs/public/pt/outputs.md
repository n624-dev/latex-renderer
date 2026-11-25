---
slug: outputs
category: Web e CLI
title: Obter PDF, PNG e SVG
description: Salve o PDF, baixe imagens de páginas e extraia fórmulas e diagramas TikZ como SVG.
navOrder: 55
updated: "2026-11-22"
since: "v1.5.0"
---

## Abrir e salvar um PDF {#pdf-を開く-保存する}

- **Aplicativo web.** Selecione o documento no [Histórico](/app/history/) e abra `result.pdf` na lista de arquivos dos resultados. Mesmo com saída PDF e SVG, o PDF pode ser baixado assim que estiver pronto.
- **CLI.** Baixe usando o `<jobId>` exibido. Acrescente `--pdf-only` para obter o PDF antes do fim da extração de SVG. Se precisar preservar os arquivos de outro documento, use uma pasta `--output` exclusiva.

```sh
n624-latex jobs download <jobId> --pdf-only --output .render
```

## Obter imagens das páginas {#ページ画像を取得する}

Para obter imagens de páginas inteiras, use as prévias PNG. A primeira página é gerada inicialmente e as demais, sob demanda. Se a prévia estiver em preparação, aguarde ou reabra a mesma página. É possível baixar o PDF final enquanto isso.

- **Aplicativo web.** Selecione na página de resultados a prévia da página desejada.
- **CLI.** O exemplo baixa os PNGs das páginas 2 e 5. Os arquivos têm nomes como `.render/previews/page-2.png`.

```sh
n624-latex jobs download <jobId> --preview-page 2 5 --output .render
```

## Salvar fórmulas e TikZ como SVG {#数式と-tikz-を-svg-で保存する}

As expressões matemáticas mais externas e os diagramas TikZ de nível superior podem ser extraídos individualmente como imagens vetoriais (SVG).

- **Aplicativo web.** Antes de converter, abra **Destino e opções de saída** e marque **Exportar também equações e TikZ como SVG**. Quando terminar, baixe os arquivos na seção de resultados SVG.
- **CLI.** Converta usando `--svg`. Os SVGs são salvos em `.render/svg/objects/`. As correspondências com as linhas do `.tex` original e as coordenadas no PDF estão em `.render/svg/manifest.json`.

```sh
n624-latex render . --svg
```

## Quando há um PDF, mas a extração de SVG falha {#pdf-はあるが-svg-が失敗した場合}

**Sucesso parcial** indica que apenas a etapa SVG falhou. Salve o PDF concluído. Depois, você pode repetir a extração sem recompilar o PDF.

- **Aplicativo web.** Nos resultados, clique em **Tentar novamente apenas SVG**.
- **CLI.** Execute o seguinte comando.

```sh
n624-latex jobs retry-svg <jobId> --output .render
```

**Condições e limite de tentativas**
- São permitidas **até 8 tentativas**, incluindo a primeira, enquanto a entrada original e o PDF final estiverem disponíveis e o ambiente TeX do servidor não tiver mudado. Repetir não estende o prazo de retenção.
- Se as falhas persistirem, consulte o diagnóstico na página de resultados ou em `.render/svg/errors.json`.
- Se aparecer `SVG_RUNTIME_CHANGED` ou se um trabalho antigo não exibir a opção de repetir, [inicie outra conversão usando o documento original ou uma revisão salva](/pt/docs/web/#以前の文書や結果を開く).

Consulte [Download e novas tentativas pela API HTTP](/pt/docs/api/#pdfの先行公開とsvgの再試行) e a [especificação do processamento das saídas](https://github.com/n624-dev/latex-renderer/blob/main/docs/independent-output-stages.md).
