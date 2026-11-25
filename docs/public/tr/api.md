---
slug: api
category: API
title: Genel API
description: HTTP üzerinden ZIP gönderin, dönüştürmenin durumunu sorgulayın ve PDF’yi indirin.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## İş akışı {#利用の流れ}

Bir işleme API anahtarı (`lrk_...`) ve [desteklenen bir ZIP](/tr/docs/projects/#構成) hazırlayın. Akışı baştan sona denemek için [curl örneğine](#curlの例) bakın.

1. **Girdi için yer ayırın.** ZIP’in bayt cinsinden boyutunu ve SHA-256 değerini hesaplayın. Kaynak dosya kümesi (Source) için `POST /api/v1/source-tickets` ile yer ayırın.
2. **ZIP’i yükleyin.** Yalnızca `uploadRequired` değeri `true` ise dönen URL’yi ve kısa ömürlü `uploadTicket` değerini kullanıp ZIP’i `PUT` ile gönderin. Aynı kullanıcının aynı içeriğe sahip geçerli ZIP’i varsa yeniden kullanılır.
3. **İşi oluşturun.** Hazırlanan `sourceId` ve ana belgenin göreli yolunu (`entrypoint`) `POST /api/v1/render-tickets` isteğinde kullanın. Tek dönüştürme için ilk üç adımı birleştiren [önceki akışı](#ジョブ作成) da kullanabilirsiniz.
4. **Durumu sorgulayıp indirin.** Kısa ömürlü `jobTicket` ile `GET /api/v1/jobs/{jobId}` yolunu aralıklarla sorgulayın ve tamamlanınca PDF ile diğer dosyaları alın.

OpenAPI tanımları [yer ayırma ve iş oluşturmayı (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) ve [yükleme ile çıktı indirmeyi (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml) kapsar.

## Kimlik doğrulama ve kapsamlar {#認証とスコープ}

Tüm kimlik bilgilerini HTTP `Authorization: Bearer <TOKEN>` üstbilgisinde gönderin.

- **API anahtarı (`lrk_...`).** Girdi için yer ayırma, iş oluşturma, proje işlemleri, iş belirteçlerini yeniden verme (`job-tickets`) ve SVG’yi yeniden deneme için kullanılır.
  - `render:create` iş oluşturma, proje oluşturma, yeniden adlandırma ve silme, revizyon kaydetme izni verir.
  - `render:read:own` kendi işlerinizin kısa ömürlü belirteçlerini yenilemeye ve proje ile geçmişi incelemeye izin verir.
- **Kısa ömürlü belirteçler (`uploadTicket` ve `jobTicket`).** ZIP yükleme, durum sorgulama, iptal, dosya indirme veya işi silme için kullanılır.

> [!WARNING]
> API anahtarını, `uploadTicket` ve `jobTicket` değerlerini günlüklere, URL sorgu dizelerine veya girdi ZIP’lerine eklemeyin.

> [!NOTE]
> **İş, onu oluşturan anahtara aittir.** Aynı kullanıcı veya hizmet hesabına ait başka bir anahtar bile `job-tickets` yenileyemez, aynı `Idempotency-Key` ile oluşturma yanıtını tekrar alamaz veya SVG’yi yeniden deneyemez. Sunucu `404` döndürür. İlk anahtarın iptali sahipliği devretmez. Aynı kullanıcının anahtarları girdileri ve projeleri paylaşır. Başka bir anahtar paylaşılan girdiden yeni bir `Idempotency-Key` ile **yeni iş** oluşturabilir.

## API uç noktaları {#apiエンドポイント}

| Yöntem | Yol | Amaç |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Girdi için yer ayırma veya aynı kullanıcının ZIP’ini yeniden kullanma |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Girdi ZIP’ini yükleyip doğrulama |
| `POST` | `/api/v1/render-tickets` | Girdiden iş oluşturma, SVG’yi yeniden deneme veya tek işe yükleme için yer ayırma |
| `POST` | `/api/v1/job-tickets/{jobId}` | Kendi işiniz için `jobTicket` değerini yeniden verme |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Önceki tek iş akışında ZIP’i doğrudan yükleme |
| `GET` | `/api/v1/jobs/{jobId}` | İşin durumunu ve hatalarını alma |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Kuyruktaki veya çalışan işi iptal etme |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | PDF, günlük, yapılandırılmış hata veya SVG alma |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | `page-N.png` önizlemesini alma |
| `DELETE` | `/api/v1/jobs/{jobId}` | Tamamlanmış işi silinmek üzere işaretleme |
| `GET` / `POST` | `/api/v1/projects` | Kayıtlı projeleri listeleme veya oluşturma |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Ayrıntı ve revizyon alma, projeyi yeniden adlandırma veya silme (kaydı gizleme) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Hazır girdiyi değişmez revizyon olarak kaydetme |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Revizyonun iş geçmişini alma |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Revizyonu yeniden dönüştürme |

> [!DETAILS] Kayıtlı projeler ve bakım modları
>
> - **Proje parametreleri.** Listelerde, ayrıntılarda ve iş geçmişinde sayfalamak için `cursor` ve `pageSize` kullanın. Revizyon kaydederken (`POST .../revisions`) `sourceId`, `entrypoint` (bir `.tex` dosyasına göreli yol), `displayName`, `originalFilename` ve `outputs` gönderin. Proje, girdi ve giriş noktası eşleşiyorsa mevcut revizyon kullanılır. Revizyonu işleme (`POST .../render`) 16–200 karakterlik bir `Idempotency-Key` gerektirir. `outputs` verilmezse ilk ayarlar kullanılır.
> - **Bakım kısıtları**
>   - `reject-new-jobs` projeleri görüntülemeye, yeniden adlandırıp silmeye, revizyon kaydetmeye ve girdi hazırlamaya izin verir. Yeni işler reddedilir.
>   - `read-only` ve `lockdown` proje değişikliklerini, girdi için yer ayırmayı, yüklemeyi, revizyonları ve girdiye başvuruları reddeder. Önceden yer ayrılmış yüklemelerde yayımlanmadan önce mod yeniden denetlenir. Yeni mod yasaklıyorsa yükleme tamamlanmaz.

## İş oluşturma {#ジョブ作成}

### Yöntem 1. İş oluşturmadan önce yeniden kullanılabilir girdiyi hazırlama (önerilir) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Girdi için yer ayırın.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. ZIP’i yalnızca `uploadRequired: true` olduğunda yükleyin. Boyut ve SHA-256 ayrılan değerlerle tam eşleşmelidir. Başarı yanıtı HTTP `204` olur.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Hazır `sourceId` ile işi oluşturun. `entrypoint` için varsayılan değer `main.tex`, `outputs` için `["pdf"]` şeklindedir. Yalnızca `["svg"]` istenemez.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

ZIP zaten hazır olduğundan yanıtta `uploadTicket` ve `uploadUrl` bulunmaz.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Yöntem 2. Tek iş için yer ayırıp doğrudan yükleme {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

ZIP’i dönen `uploadUrl` adresine (`/api/v1/jobs/{jobId}/source`) `uploadTicket` kullanarak `PUT` yöntemiyle gönderin. Başarı yanıtı HTTP `204` olur.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Girdinin saklanması ve Idempotency-Key
>
> - **Başvurusuz girdiler ve başvurular.** Etkin revizyon veya işlerin başvurmadığı hazır girdi varsayılan olarak 1 saat sonra temizlenir. `deleted` ve `expired` dışındaki tamamlanmış işler de başvuru sayılır. Yönetici `source_orphan_retention_minutes` değerini 5 dakika ile 24 saat arasında ayarlayabilir. Geçerli başvuru varken girdi başvurusuz saklama süresinin ötesinde korunur ve kullanılabilir. Son başvuru kalktığında bu süre zaten dolmuşsa girdi erişilemez olur ve temizlenebilir. Başvuru, kısmen yüklenmiş ya da silinmekte olan girdiyi yeniden hazır hâle getirmez.
> - **`expiresAt` anlamı.** Yüklemeden önce tamamlanmamış yer ayırmanın bitişini (10 dakika) gösterir. Hazır girdide, başvuru olmaması hâlinde sürenin ne zaman dolacağını belirtir. Web, HTTP API ve MCP’de aynıdır. Bir MCP `sourceRef` en fazla 15 dakika geçerlidir ve girdinin saklanmasını uzatmaz.
> - **`Idempotency-Key` davranışı.** Aynı ZIP yeniden kullanıldığında anahtar kabulden itibaren 24 saat kayıtlı kalır. Yeniden gönderme süreyi uzatmaz. Bu sürede farklı içerik `409`, süresi dolmuş ilk girdi `410`, silinmiş girdi `404` ve devam eden yükleme `409` döndürür. 24 saat sonra zamanlanmış temizliği beklemeden anahtarı yeniden kullanabilirsiniz. İlk girdi bu yolla geri getirilmez.

### PDF’nin erken kullanıma açılması ve SVG’yi yeniden deneme {#pdfの先行公開とsvgの再試行}

Web ve CLI için [PDF, PNG ve SVG alma](/tr/docs/outputs/) bölümüne bakın.

- **Erken erişim ve `stages`.** PDF ve SVG işinde doğrulanmış PDF ile önizlemeler SVG tamamlanmadan alınabilir. Genel `status` tüm çıktıların sonucunu belirtir. `stages.pdf` (`sha256` ile) ve `stages.svg` (`attempt` ile) aşama durumunu, tamamlanma zamanını ve hataları gösterir. Eski işler için bu alanlar tahmin edilmez.
- **Yalnızca SVG’yi yeniden deneme.** `POST /api/v1/render-tickets` uç noktasına API anahtarıyla kimlik doğrulayarak (`jobTicket` kabul edilmez) `{"retrySvgJobId":"job_..."}` gövdesi ve bir `Idempotency-Key` ile istek gönderin. İlk `jobTicket` döner ve PDF yeniden derlenmeden, saklama süresi uzatılmadan çıkarma yinelenir. Girdi, PDF ve çalışma ortamı eşleşiyorsa ilk deneme dahil en fazla 8 denemeye izin verilir. SVG tanılaması `svg/compile.log`, `svg/errors.json` ve `svg/dependencies.json` içindedir.

> [!DETAILS] `svg/manifest.json` koordinatları ve şeması (schemaVersion 2)
>
> SVG’ler `svg/objects/math-NNNNNN.svg` veya `tikz-NNNNNN.svg` olarak `Content-Type: image/svg+xml` ve `Content-Disposition: attachment` ile kaydedilir. Nesne sayısı uyuşmazsa veya etkin içerik (dış başvurular, betikler veya olay öznitelikleri) varsa işin tamamı başarısız olur. `svg/manifest.json` eşlemeleri tanımlar. Yeni çıktılar her zaman `schemaVersion: 2` kullanır, `1` sürümü okunmaya devam eder.
>
> - **Koordinatlar (`coordinateSystem`).** `id` ve `page` 1’den başlar. Birim PDF noktasıdır (1/72 inç). Başlangıç sol üst köşedir; x sağa, y aşağıya artar.
> - **Konum biliniyor (`placementStatus: "known"`)**
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
> - **Konum bilinmiyor (`placementStatus: "unknown"`).** SyncTeX örneğin aynı satırdaki birden çok ifadeyi ayırt edemiyorsa `page`, `x` ve `y` tahmin edilmeden atlanır. Bu durumda `width` ve `height` çıkarılan SVG’nin boyutudur, PDF’deki konumu değildir. PDF üstüne yerleştirmeden önce `schemaVersion` ve `placementStatus` değerlerini denetleyin.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## ZIP yükleme {#zipアップロード}

Bu uç nokta önceki akışta ayrılmış bir işe ZIP yükler. Ayrı hazırlanmış girdi için `PUT /api/v1/sources/{sourceId}/content` kullanın.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## İş durumları {#ジョブ状態}

| Durum | Anlam | İstemcinin yapması gereken |
| --- | --- | --- |
| `reserved` / `uploading` | Yer ayrılmış veya yükleniyor | Süre dolmadan ZIP’i gönderin |
| `queued` / `validating` / `running` | Kuyrukta, doğrulanıyor veya derleniyor | Sorgular arasında bekleyin |
| `succeeded` | Başarılı | PDF ve gerekli dosyaları indirin |
| `failed` / `timeout` / `rejected` | Başarısız, süre dolmuş veya reddedilmiş | Hataları denetleyin |
| `canceled` | İptal edilmiş | Gerekirse yeni iş oluşturun |
| `deleting` / `deleted` / `expired` | Siliniyor, silinmiş veya süresi dolmuş | Gerekirse yeni iş oluşturun |

**Saklama ve devam eden indirmelerin korunması**
Tamamlanmadan (bu bilgi olmayan eski işlerde son güncellemeden) itibaren `ARTIFACT_RETENTION_HOURS` (varsayılan 24 saat) geçince temizlenmeyi bekleyen dosyalar hâlâ bulunsa bile yeni indirme başlatılamaz. Bu kural web, API, işleyici ve Remote MCP için geçerlidir. Zamanında başlayan indirmeler, ZIP alımları ve MCP okumaları silinmeye karşı korumayı yalnızca veri aktarılırken yeniler. Koruma işlem bittiğinde veya bağlantı kesildiğinde bırakılır. Aktarım olağan dışı kesilirse son yenilemeden 5 dakika sonra sona erer. Yenileme başarısız olursa süresi dolmuş dosyalar yeniden açılmadan aktarım iptal edilir.

## Sık hatalar {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| HTTP durumu | Anlam | Ne zaman yeniden denenir |
| --- | --- | --- |
| `400` | Geçersiz girdi, üstbilgi veya ZIP içeriği | Göndermeden önce verileri düzeltin |
| `401` / `403` | Geçersiz, süresi dolmuş veya kapsamı yetersiz belirteç | Kimlik bilgilerini ve izinleri denetleyin |
| `404` / `410` | İş veya dosya yok, başka anahtara ait ya da girdinin süresi dolmuş | Gerekirse yeni iş oluşturun |
| `409` | Uyuşmayan durum veya `Idempotency-Key` çakışması | Mevcut durumu sorgulayın |
| `429` / `503` | Hız sınırı, yetersiz kapasite, dolu kuyruk veya bakım | Yeniden denemeden önce bekleyin |

## curl örneği {#curlの例}

Linux’ta Bash için bu uçtan uca örnek yer ayırır, `source.zip` yükler, 2 saniyede bir en fazla 60 kez durumu sorgular ve PDF’yi kaydeder. ZIP’in bulunduğu dizinde çalıştırın. `curl`, `jq`, `sha256sum` ve `uuidgen` gerekir. Kendi sunucunuz için `base` değerini değiştirin.

> [!DETAILS] ZIP yükleyip PDF indirme
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

60 sorgu sonra iş hâlâ bitmediyse gösterilen `jobId` ile aynı işi daha sonra sorgulayın. `jobTicket` süresi dolarsa işi oluşturan API anahtarıyla `POST /api/v1/job-tickets/{jobId}` çağırın. Şu örnekler yer ayırmayı ve ZIP yüklemeyi kapsar.

## PowerShell {#powershell}

> [!DETAILS] PowerShell örneği
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

> [!DETAILS] JavaScript / TypeScript örneği
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

> [!DETAILS] Python örneği
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
