---
slug: api
category: API
title: API pública
description: Envie um ZIP por HTTP, consulte o estado da conversão e baixe o PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Fluxo de trabalho {#利用の流れ}

Prepare uma chave da API de renderização (`lrk_...`) e um [ZIP compatível](/pt/docs/projects/#構成). Para testar o fluxo completo, consulte o [exemplo com curl](#curlの例).

1. **Reserve a entrada.** Calcule o tamanho do ZIP em bytes e o SHA-256. Reserve o conjunto de arquivos (Source) com `POST /api/v1/source-tickets`.
2. **Envie o ZIP.** Somente se `uploadRequired` for `true`, use a URL retornada e o `uploadTicket` de curta duração para enviar o ZIP com `PUT`. Se já existir um ZIP idêntico e válido do mesmo usuário, ele será reutilizado.
3. **Crie o trabalho.** Use o `sourceId` preparado e o caminho relativo do documento principal (`entrypoint`) em `POST /api/v1/render-tickets`. Para uma conversão única, também pode usar o [fluxo anterior](#ジョブ作成) que reúne as etapas 1 a 3.
4. **Consulte o estado e baixe o resultado.** Use o `jobTicket` de curta duração para consultar `GET /api/v1/jobs/{jobId}` periodicamente e obter o PDF e os demais arquivos ao terminar.

As definições OpenAPI abrangem [reservas e criação de trabalhos (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) e [envio e download dos resultados (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Autenticação e escopos {#認証とスコープ}

Envie todas as credenciais no cabeçalho HTTP `Authorization: Bearer <TOKEN>`.

- **Chave de API (`lrk_...`).** Usada para reservar entradas, criar trabalhos, gerenciar projetos, reemitir tokens de trabalho (`job-tickets`) e repetir a extração de SVG.
  - `render:create` permite criar trabalhos, criar, renomear e excluir projetos e salvar revisões.
  - `render:read:own` permite renovar tokens de curta duração dos próprios trabalhos e consultar projetos e histórico.
- **Tokens de curta duração (`uploadTicket` e `jobTicket`).** Usados para enviar o ZIP, consultar o estado, cancelar, baixar arquivos ou excluir um trabalho.

> [!WARNING]
> Mantenha a chave de API, `uploadTicket` e `jobTicket` fora dos registros, parâmetros de consulta de URLs e ZIPs de entrada.

> [!NOTE]
> **O trabalho pertence à chave que o criou.** Mesmo que outra chave pertença ao mesmo usuário ou conta de serviço, ela não pode renovar `job-tickets`, repetir a resposta de criação usando a mesma `Idempotency-Key` nem solicitar nova tentativa de SVG. O servidor retorna `404`. Revogar a chave original não transfere a propriedade. As entradas e projetos são compartilhados entre as chaves do mesmo usuário. Outra chave pode criar um **novo trabalho** a partir de uma entrada compartilhada usando uma nova `Idempotency-Key`.

## Endpoints da API {#apiエンドポイント}

| Método | Caminho | Finalidade |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Reservar uma entrada ou reutilizar um ZIP do mesmo usuário |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Enviar e verificar o ZIP de entrada |
| `POST` | `/api/v1/render-tickets` | Criar um trabalho a partir de uma entrada, repetir a extração de SVG ou reservar um envio para um único trabalho |
| `POST` | `/api/v1/job-tickets/{jobId}` | Reemitir um `jobTicket` para um trabalho próprio |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Enviar o ZIP diretamente pelo fluxo anterior de trabalho único |
| `GET` | `/api/v1/jobs/{jobId}` | Obter o estado e os erros do trabalho |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Cancelar um trabalho na fila ou em andamento |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Obter PDF, registros, erros estruturados ou SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Obter uma prévia `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Marcar um trabalho concluído para exclusão |
| `GET` / `POST` | `/api/v1/projects` | Listar ou criar projetos salvos |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Consultar detalhes e revisões, renomear ou excluir o projeto (ocultar o registro) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Salvar uma entrada pronta como revisão imutável |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Obter o histórico de trabalhos de uma revisão |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Converter uma revisão novamente |

> [!DETAILS] Projetos salvos e modos de manutenção
>
> - **Parâmetros de projeto.** Use `cursor` e `pageSize` para paginar listas, detalhes e histórico de trabalhos. Para salvar uma revisão (`POST .../revisions`), envie `sourceId`, `entrypoint` (caminho relativo até um arquivo `.tex`), `displayName`, `originalFilename` e `outputs`. Se o projeto, a entrada e o ponto de entrada coincidirem, a revisão será reutilizada. A renderização de uma revisão (`POST .../render`) exige uma `Idempotency-Key` de 16 a 200 caracteres. Se omitir `outputs`, serão usadas as configurações iniciais.
> - **Restrições de manutenção**
>   - `reject-new-jobs` permite visualizar, renomear e excluir projetos, salvar revisões e preparar entradas. Novos trabalhos são rejeitados.
>   - `read-only` e `lockdown` rejeitam mudanças em projetos, reservas, envios, revisões e referências de entradas. Os envios já reservados voltam a verificar o modo antes da publicação e não são concluídos se o modo tiver passado a proibi-los.

## Criar um trabalho {#ジョブ作成}

### Método 1. Preparar uma entrada reutilizável antes de criar o trabalho (recomendado) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Reserve a entrada.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Envie o ZIP somente quando `uploadRequired: true`. O tamanho e o SHA-256 devem coincidir exatamente com a reserva. A resposta de sucesso é HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Crie o trabalho com o `sourceId` pronto. O padrão de `entrypoint` é `main.tex` e o de `outputs` é `["pdf"]`. Não é permitido solicitar somente `["svg"]`.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

A resposta omite `uploadTicket` e `uploadUrl` porque o ZIP já está disponível.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Método 2. Reservar e enviar diretamente para um único trabalho {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Envie o ZIP à `uploadUrl` retornada (`/api/v1/jobs/{jobId}/source`) usando o `uploadTicket` e o método `PUT`. A resposta de sucesso é HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Retenção de entradas e Idempotency-Key
>
> - **Entradas órfãs e referências.** Por padrão, uma entrada pronta sem revisão ativa nem trabalho que a referencie é removida após 1 hora. Os trabalhos concluídos também contam, à exceção de `deleted` e `expired`. O administrador pode ajustar `source_orphan_retention_minutes` entre 5 minutos e 24 horas. Com uma referência válida, a entrada é mantida e pode ser reutilizada após o prazo para entradas órfãs. Se esse prazo já tiver terminado quando desaparecer a última referência, a entrada ficará inacessível e poderá ser removida. Uma referência não torna pronta uma entrada em envio ou em processo de exclusão.
> - **Significado de `expiresAt`.** Antes do envio, indica a expiração da reserva incompleta (10 minutos). Quando a entrada fica pronta, indica o momento em que expiraria sem referências. O comportamento é o mesmo na web, na API HTTP e no MCP. Um `sourceRef` do MCP dura até 15 minutos e não prolonga a retenção da entrada.
> - **Tratamento de `Idempotency-Key`.** Ao reutilizar um ZIP idêntico, a chave é registrada por 24 horas a partir da aceitação. Retransmissões não prolongam esse prazo. Durante o prazo, usar conteúdo diferente retorna `409`, uma entrada original expirada retorna `410`, uma excluída retorna `404` e um envio em curso retorna `409`. Após 24 horas, você pode reutilizar a chave sem aguardar a limpeza periódica. Isso não restaura a entrada original.

### Disponibilidade antecipada do PDF e novas tentativas de SVG {#pdfの先行公開とsvgの再試行}

Para instruções sobre a web e a CLI, consulte [Obter PDF, PNG e SVG](/pt/docs/outputs/).

- **Acesso antecipado e `stages`.** Em um trabalho PDF e SVG, o PDF verificado e as prévias ficam disponíveis antes da conclusão do SVG. O `status` geral indica o resultado do conjunto. `stages.pdf` (com `sha256`) e `stages.svg` (com `attempt`) informam o estado, o horário de conclusão e os erros de cada etapa. Esses campos não são inferidos em trabalhos antigos.
- **Repetir apenas o SVG.** Use `POST /api/v1/render-tickets` com autenticação por chave de API (não aceita `jobTicket`), o corpo `{"retrySvgJobId":"job_..."}` e uma `Idempotency-Key`. Retorna o `jobTicket` original e repete a extração sem recompilar o PDF nem prolongar sua retenção. São permitidas até 8 tentativas incluindo a inicial, desde que a entrada, o PDF e o ambiente de execução coincidam. Os diagnósticos de SVG estão em `svg/compile.log`, `svg/errors.json` e `svg/dependencies.json`.

> [!DETAILS] Coordenadas e esquema de `svg/manifest.json` (schemaVersion 2)
>
> Os SVGs são salvos como `svg/objects/math-NNNNNN.svg` ou `tikz-NNNNNN.svg` com `Content-Type: image/svg+xml` e `Content-Disposition: attachment`. Se a quantidade de objetos divergir ou houver conteúdo ativo (referências externas, scripts ou atributos de evento), o trabalho inteiro falha. `svg/manifest.json` registra as correspondências. Novas saídas usam sempre `schemaVersion: 2`, mantendo a leitura da versão `1`.
>
> - **Coordenadas (`coordinateSystem`).** `id` e `page` começam em 1. A unidade é o ponto PDF (1/72 de polegada), com origem no canto superior esquerdo, eixo x para a direita e eixo y para baixo.
> - **Posição conhecida (`placementStatus: "known"`)**
>   ```json
>   {
>     "id": 1,
>     "kind": "math",
>     "artifact": "svg/objects/math-000001.svg",
>     "sourceFile": "chapters/formula.tex",
>     "sourceLine": 18,
>     "placementStatus": "known",
>     "page": 2,
>     "x": 123.4,
>     "y": 85.2,
>     "width": 210.6,
>     "height": 32.8
>   }
>   ```
> - **Posição desconhecida (`placementStatus: "unknown"`).** Quando o SyncTeX não consegue distinguir, por exemplo, várias expressões na mesma linha, os campos `page`, `x` e `y` são omitidos, sem estimativa de coordenadas. Nesse caso, `width` e `height` medem o SVG extraído, sem indicar sua posição no PDF. Confira `schemaVersion` e `placementStatus` antes de sobrepor o objeto ao PDF.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Enviar o ZIP {#zipアップロード}

Este endpoint envia um ZIP a um trabalho reservado pelo fluxo anterior. Para uma entrada preparada separadamente, use `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## Estados do trabalho {#ジョブ状態}

| Estado | Significado | Ação do cliente |
| --- | --- | --- |
| `reserved` / `uploading` | Reservado ou em envio | Enviar o ZIP antes que a reserva expire |
| `queued` / `validating` / `running` | Na fila, em validação ou em compilação | Aguardar entre as consultas |
| `succeeded` | Sucesso | Baixar o PDF e os arquivos necessários |
| `failed` / `timeout` / `rejected` | Falha, tempo esgotado ou rejeição | Conferir os erros |
| `canceled` | Cancelado | Criar outro trabalho, se necessário |
| `deleting` / `deleted` / `expired` | Em exclusão, excluído ou expirado | Criar outro, se necessário |

**Retenção e proteção dos downloads em andamento**
Transcorrido `ARTIFACT_RETENTION_HOURS` (24 horas por padrão) desde a conclusão ou, em trabalhos antigos sem essa informação, desde a última atualização, novos downloads são rejeitados mesmo que ainda haja arquivos aguardando limpeza. Isso se aplica à web, à API, ao renderizador e ao Remote MCP. Downloads, recuperações de ZIP e leituras MCP iniciados dentro do prazo renovam a proteção contra exclusão somente enquanto há transferência de dados. A proteção é liberada ao concluir ou desconectar. Se a transferência terminar de modo anormal, a proteção expira 5 minutos após a última renovação. Se a renovação falhar, a transferência é cancelada sem reativar arquivos expirados.

## Erros frequentes {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| Estado HTTP | Significado | Quando repetir |
| --- | --- | --- |
| `400` | Entrada, cabeçalhos ou conteúdo do ZIP inválidos | Corrigir os dados antes de enviar |
| `401` / `403` | Token inválido, expirado ou com escopo insuficiente | Conferir credenciais e permissões |
| `404` / `410` | Trabalho ou arquivo ausente, trabalho pertencente a outra chave ou entrada expirada | Criar outro trabalho, se necessário |
| `409` | Estado incompatível ou conflito de `Idempotency-Key` | Consultar o estado atual |
| `429` / `503` | Limite de frequência, falta de capacidade, fila cheia ou manutenção | Aguardar antes de repetir |

## Exemplo com curl {#curlの例}

Este exemplo completo para Bash no Linux reserva a entrada, envia `source.zip`, consulta o estado a cada 2 segundos até 60 vezes e salva o PDF. Execute-o no diretório do ZIP. Requer `curl`, `jq`, `sha256sum` e `uuidgen`. Para hospedagem própria, altere `base`.

> [!DETAILS] Enviar um ZIP e baixar o PDF
>
> ```bash
> (
>   set -euo pipefail
>   base=https://latex-render.n624.jp
>   zip=source.zip
>   read -rs -p 'Rendering API key: ' api_key
>   printf '\n'
>   size=$(wc -c < "$zip")
>   digest=$(sha256sum "$zip")
>   idempotency_key=$(uuidgen)
>   request=$(jq -n --argjson size "$size" --arg sha "${digest%% *}" \
>     '{size: $size, sha256: $sha}')
>
>   reservation=$(curl -fsS "$base/api/v1/render-tickets" \
>     --header @- \
>     -H "Idempotency-Key: $idempotency_key" \
>     -H 'Content-Type: application/json' --data "$request" <<< "Authorization: Bearer $api_key")
>   job_id=$(jq -er '.jobId' <<< "$reservation")
>   token=$(jq -er '.jobTicket' <<< "$reservation")
>   upload_token=$(jq -er '.uploadTicket' <<< "$reservation")
>   printf 'Job ID: %s\n' "$job_id"
>
>   curl -fsS --upload-file "$zip" "$base/api/v1/jobs/$job_id/source" \
>     --header @- \
>     -H 'Content-Type: application/zip' <<< "Authorization: Bearer $upload_token"
>
>   for attempt in {1..60}; do
>     status=$(curl -fsS "$base/api/v1/jobs/$job_id" \
>       --header @- <<< "Authorization: Bearer $token" | jq -er '.status')
>     case "$status" in
>       succeeded)
>         curl -fsS "$base/api/v1/jobs/$job_id/artifacts/result.pdf" \
>           --header @- --output result.pdf <<< "Authorization: Bearer $token"
>         printf 'Saved result.pdf\n'
>         exit 0
>         ;;
>       reserved|uploading|queued|validating|running) sleep 2 ;;
>       *) printf 'Job %s: %s\n' "$job_id" "$status" >&2; exit 1 ;;
>     esac
>   done
>   printf 'Job %s is still pending; check the same job later.\n' "$job_id" >&2
>   exit 1
> )
> ```

Se ainda estiver pendente após 60 consultas, use o `jobId` exibido para consultar o mesmo trabalho mais tarde. Se `jobTicket` expirar, chame `POST /api/v1/job-tickets/{jobId}` com a chave de API que criou o trabalho. Os exemplos a seguir cobrem a reserva e o envio do ZIP.

## PowerShell {#powershell}

> [!DETAILS] Exemplo de PowerShell
>
> ```powershell
> $zip = Resolve-Path .\source.zip
> $bytes = [IO.File]::ReadAllBytes($zip)
> $sha = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
> $headers = @{
>   Authorization = "Bearer $env:LATEX_RENDER_API_KEY"
>   "Idempotency-Key" = [guid]::NewGuid().ToString()
> }
> $ticket = Invoke-RestMethod -Method Post `
>   -Uri https://latex-render.n624.jp/api/v1/render-tickets `
>   -Headers $headers -ContentType application/json `
>   -Body (@{size=$bytes.Length;sha256=$sha} | ConvertTo-Json)
> Invoke-WebRequest -Method Put -Uri $ticket.uploadUrl `
>   -Headers @{Authorization="Bearer $($ticket.uploadTicket)"} `
>   -ContentType application/zip -InFile $zip
> ```

## JavaScript / TypeScript {#javascript-typescript}

> [!DETAILS] Exemplo de JavaScript / TypeScript
>
> ```typescript
> import { readFile } from "node:fs/promises";
> import { createHash, randomUUID } from "node:crypto";
>
> const zip = await readFile("source.zip");
> const sha256 = createHash("sha256").update(zip).digest("hex");
> const response = await fetch(
>   "https://latex-render.n624.jp/api/v1/render-tickets",
>   {
>     method: "POST",
>     headers: {
>       Authorization: "Bearer " + process.env.LATEX_RENDER_API_KEY,
>       "Content-Type": "application/json",
>       "Idempotency-Key": randomUUID(),
>     },
>     body: JSON.stringify({ size: zip.length, sha256 }),
>   },
> );
> if (!response.ok) throw new Error(`Reservation failed: ${response.status}`);
> const ticket = await response.json();
> const upload = await fetch(ticket.uploadUrl, {
>   method: "PUT",
>   headers: {
>     Authorization: "Bearer " + ticket.uploadTicket,
>     "Content-Type": "application/zip",
>   },
>   body: zip,
> });
> if (!upload.ok) throw new Error(`Upload failed: ${upload.status}`);
> ```

## Python {#python}

> [!DETAILS] Exemplo de Python.
>
> ```python
> import hashlib
> import os
> import pathlib
> import uuid
>
> import requests
>
> data = pathlib.Path("source.zip").read_bytes()
> headers = {
>     "Authorization": "Bearer " + os.environ["LATEX_RENDER_API_KEY"],
>     "Idempotency-Key": str(uuid.uuid4()),
> }
> response = requests.post(
>     "https://latex-render.n624.jp/api/v1/render-tickets",
>     headers=headers,
>     json={"size": len(data), "sha256": hashlib.sha256(data).hexdigest()},
> )
> response.raise_for_status()
> ticket = response.json()
> requests.put(
>     ticket["uploadUrl"],
>     headers={
>         "Authorization": "Bearer " + ticket["uploadTicket"],
>         "Content-Type": "application/zip",
>     },
>     data=data,
> ).raise_for_status()
> ```
