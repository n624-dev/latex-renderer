---
slug: api
category: API
title: API publique
description: Envoyez un ZIP par HTTP, suivez l’état de la conversion et téléchargez le PDF.
navOrder: 70
updated: "2026-11-22"
since: "v1.0.0"
---

## Déroulement d’une conversion {#利用の流れ}

Préparez une clé d’API de rendu (`lrk_...`) et un [ZIP compatible](/fr/docs/projects/#構成). Pour essayer le parcours complet, consultez l’[exemple avec curl](#curlの例).

1. **Réservez les sources.** Calculez la taille du ZIP en octets et son SHA-256. Réservez le jeu de sources (Source) avec `POST /api/v1/source-tickets`.
2. **Envoyez le ZIP.** Uniquement si `uploadRequired` vaut `true`, utilisez l’URL renvoyée et le `uploadTicket` de courte durée pour transmettre le ZIP avec `PUT`. Si un ZIP identique et valide du même utilisateur existe déjà, il est réutilisé.
3. **Créez la tâche.** Indiquez le `sourceId` préparé et le chemin relatif du document principal (`entrypoint`) dans `POST /api/v1/render-tickets`. Pour une conversion ponctuelle, vous pouvez aussi utiliser l’[ancien parcours](#ジョブ作成) qui regroupe les étapes 1 à 3.
4. **Consultez l’état et téléchargez.** Utilisez le `jobTicket` de courte durée pour interroger `GET /api/v1/jobs/{jobId}` périodiquement et récupérer le PDF et les autres fichiers à la fin.

Les définitions OpenAPI couvrent les [réservations et la création des tâches (gateway.openapi.yaml)](/openapi/gateway.openapi.yaml) ainsi que les [envois et le téléchargement des résultats (renderer.openapi.yaml)](/openapi/renderer.openapi.yaml).

## Authentification et portées {#認証とスコープ}

Transmettez tous les identifiants dans l’en-tête HTTP `Authorization: Bearer <TOKEN>`.

- **Clé d’API (`lrk_...`).** Sert à réserver des sources, créer des tâches, gérer des projets, réémettre des jetons de tâche (`job-tickets`) et relancer les SVG.
  - `render:create` permet de créer des tâches, de créer, renommer et supprimer des projets et d’enregistrer des révisions.
  - `render:read:own` permet de renouveler les jetons de courte durée pour ses propres tâches et de consulter les projets et l’historique.
- **Jetons de courte durée (`uploadTicket` et `jobTicket`).** Servent à envoyer le ZIP, à consulter l’état, à annuler, à télécharger les fichiers ou à supprimer une tâche.

> [!WARNING]
> Gardez la clé d’API, `uploadTicket` et `jobTicket` hors des journaux, des paramètres de requête des URL et des ZIP d’entrée.

> [!NOTE]
> **Une tâche appartient à la clé qui l’a créée.** Même si une autre clé appartient au même utilisateur ou compte de service, elle ne peut ni renouveler `job-tickets`, ni rejouer la réponse de création avec la même `Idempotency-Key`, ni relancer les SVG. Le serveur renvoie `404`. Révoquer la clé initiale ne transfère pas la propriété. Les sources et projets sont partagés entre les clés du même utilisateur. Une autre clé peut créer une **nouvelle tâche** à partir de sources partagées avec une nouvelle `Idempotency-Key`.

## Points de terminaison de l’API {#apiエンドポイント}

| Méthode | Chemin | Usage |
| --- | --- | --- |
| `POST` | `/api/v1/source-tickets` | Réserver des sources ou réutiliser un ZIP du même utilisateur |
| `PUT` | `/api/v1/sources/{sourceId}/content` | Envoyer et vérifier le ZIP d’entrée |
| `POST` | `/api/v1/render-tickets` | Créer une tâche à partir de sources, relancer les SVG ou réserver un envoi pour une seule tâche |
| `POST` | `/api/v1/job-tickets/{jobId}` | Réémettre un `jobTicket` pour une tâche dont la clé est propriétaire |
| `PUT` | `/api/v1/jobs/{jobId}/source` | Envoyer le ZIP directement avec l’ancien parcours à tâche unique |
| `GET` | `/api/v1/jobs/{jobId}` | Obtenir l’état et les erreurs de la tâche |
| `POST` | `/api/v1/jobs/{jobId}/cancel` | Annuler une tâche en attente ou en cours |
| `GET` | `/api/v1/jobs/{jobId}/artifacts/{path}` | Obtenir un PDF, des journaux, des erreurs structurées ou un SVG |
| `GET` | `/api/v1/jobs/{jobId}/previews/{page}` | Obtenir un aperçu `page-N.png` |
| `DELETE` | `/api/v1/jobs/{jobId}` | Marquer pour suppression une tâche terminée |
| `GET` / `POST` | `/api/v1/projects` | Lister ou créer des projets enregistrés |
| `GET` / `PATCH` / `DELETE` | `/api/v1/projects/{projectId}` | Consulter les détails et révisions, renommer ou supprimer le projet (masquer son enregistrement) |
| `POST` | `/api/v1/projects/{projectId}/revisions` | Enregistrer des sources prêtes comme révision immuable |
| `GET` | `/api/v1/projects/{projectId}/revisions/{revisionId}/jobs` | Obtenir l’historique des tâches d’une révision |
| `POST` | `/api/v1/projects/{projectId}/revisions/{revisionId}/render` | Reconvertir une révision |

> [!DETAILS] Projets enregistrés et modes de maintenance
>
> - **Paramètres de projet.** Utilisez `cursor` et `pageSize` pour paginer les listes, les détails et l’historique des tâches. Pour enregistrer une révision (`POST .../revisions`), envoyez `sourceId`, `entrypoint` (chemin relatif d’un `.tex`), `displayName`, `originalFilename` et `outputs`. La révision est réutilisée si le projet, les sources et le point d’entrée correspondent. Le rendu d’une révision (`POST .../render`) exige une `Idempotency-Key` de 16 à 200 caractères. Si vous omettez `outputs`, les réglages initiaux sont utilisés.
> - **Restrictions de maintenance**
>   - `reject-new-jobs` permet de consulter, renommer et supprimer des projets, d’enregistrer des révisions et de préparer des sources. Les nouvelles tâches sont refusées.
>   - `read-only` et `lockdown` refusent les modifications de projets ainsi que les réservations, envois, révisions et références de sources. Les envois déjà réservés vérifient à nouveau le mode avant publication et ne se terminent pas si le mode a changé pour l’interdire.

## Créer une tâche {#ジョブ作成}

### Méthode 1. Préparer des sources réutilisables avant de créer la tâche (recommandé) {#方法-1-source-を準備してからジョブを作る-推奨-再利用対応}

1. Réservez les sources.

```http
POST /api/v1/source-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters"}
```

2. Envoyez le ZIP uniquement si `uploadRequired: true`. Il doit correspondre exactement à la taille et au SHA-256 réservés. La réponse de réussite est HTTP `204`.

```http
PUT /api/v1/sources/{sourceId}/content
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

3. Créez la tâche avec le `sourceId` prêt. La valeur par défaut de `entrypoint` est `main.tex` et celle de `outputs` est `["pdf"]`. Demander uniquement `["svg"]` est interdit.

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"sourceId":"source_...","entrypoint":"chapters/report.tex","outputs":["pdf","svg"]}
```

La réponse omet `uploadTicket` et `uploadUrl` puisque le ZIP est déjà disponible.

```json
{
  "jobId": "job_...",
  "jobTicket": "<JOB_TICKET>",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

### Méthode 2. Réserver et envoyer directement pour une seule tâche {#方法-2-1-ジョブ用の従来フロー-予約とアップロードを直結}

```http
POST /api/v1/render-tickets
Authorization: Bearer <API_KEY>
Content-Type: application/json
Idempotency-Key: <16–200 characters>

{"size":12345,"sha256":"64 lowercase hexadecimal characters","outputs":["pdf","svg"]}
```

Envoyez le ZIP à la `uploadUrl` renvoyée (`/api/v1/jobs/{jobId}/source`) avec le `uploadTicket` et la méthode `PUT`. La réponse de réussite est HTTP `204`.

```json
{
  "jobId": "job_...",
  "uploadTicket": "<UPLOAD_TICKET>",
  "jobTicket": "<JOB_TICKET>",
  "uploadUrl": "https://latex-render.n624.jp/api/v1/jobs/job_.../source",
  "expiresAt": "2026-08-17T12:34:56.000Z"
}
```

> [!DETAILS] Conservation des sources et Idempotency-Key
>
> - **Sources orphelines et références.** Par défaut, des sources prêtes que ne référence aucune révision active ni aucune tâche sont nettoyées après 1 heure. Les tâches terminées comptent également, sauf `deleted` et `expired`. L’administrateur peut régler `source_orphan_retention_minutes` entre 5 minutes et 24 heures. Tant qu’une référence est valide, les sources sont conservées et réutilisables au-delà du délai des sources orphelines. Si ce délai est écoulé à la disparition de la dernière référence, les sources deviennent inaccessibles et peuvent être nettoyées. Une référence ne remet pas à l’état prêt des sources partiellement envoyées ou en cours de suppression.
> - **Signification de `expiresAt`.** Avant l’envoi, indique l’expiration de la réservation incomplète (10 minutes). Une fois les sources prêtes, il indique quand elles expireraient sans référence. Ce principe s’applique au web, à l’API HTTP et à MCP. Un `sourceRef` MCP dure au plus 15 minutes et ne prolonge pas la conservation des sources.
> - **Traitement de `Idempotency-Key`.** Lorsqu’un ZIP identique est réutilisé, la clé est enregistrée pendant 24 heures à compter de l’acceptation. Une retransmission ne prolonge pas ce délai. Pendant cette période, un contenu différent renvoie `409`, des sources initiales expirées renvoient `410`, des sources supprimées renvoient `404` et un envoi en cours renvoie `409`. Après 24 heures, la clé peut être réutilisée sans attendre le nettoyage périodique. Cela ne restaure pas les sources initiales.

### Disponibilité anticipée du PDF et nouvelles tentatives SVG {#pdfの先行公開とsvgの再試行}

Pour le web et la CLI, consultez [Obtenir les PDF, PNG et SVG](/fr/docs/outputs/).

- **Accès anticipé et `stages`.** Pour une tâche PDF et SVG, le PDF vérifié et les aperçus sont accessibles avant la fin des SVG. Le `status` global indique le résultat de l’ensemble. `stages.pdf` (avec `sha256`) et `stages.svg` (avec `attempt`) indiquent l’état, l’heure de fin et les erreurs de chaque phase. Ces champs ne sont pas déduits pour les anciennes tâches.
- **Relancer uniquement les SVG.** Utilisez `POST /api/v1/render-tickets` avec une clé d’API (le `jobTicket` n’est pas accepté), le corps `{"retrySvgJobId":"job_..."}` et une `Idempotency-Key`. La réponse contient le `jobTicket` initial et l’extraction est relancée sans recompiler le PDF ni prolonger sa conservation. Huit tentatives au plus sont admises, première comprise, si les sources, le PDF et l’environnement d’exécution correspondent. Les diagnostics SVG figurent dans `svg/compile.log`, `svg/errors.json` et `svg/dependencies.json`.

> [!DETAILS] Coordonnées et schéma de `svg/manifest.json` (schemaVersion 2)
>
> Les SVG sont enregistrés comme `svg/objects/math-NNNNNN.svg` ou `tikz-NNNNNN.svg` avec `Content-Type: image/svg+xml` et `Content-Disposition: attachment`. Si le nombre d’objets ne correspond pas ou si du contenu actif est détecté (références externes, scripts ou attributs d’événements), la tâche entière échoue. `svg/manifest.json` associe les objets aux positions. Les nouvelles sorties utilisent toujours `schemaVersion: 2` et la lecture de la version `1` reste compatible.
>
> - **Coordonnées (`coordinateSystem`).** `id` et `page` commencent à 1. L’unité est le point PDF (1/72 de pouce), avec l’origine dans le coin supérieur gauche, x vers la droite et y vers le bas.
> - **Position connue (`placementStatus: "known"`)**
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
> - **Position inconnue (`placementStatus: "unknown"`).** Si SyncTeX ne peut pas distinguer plusieurs expressions sur une même ligne, par exemple, `page`, `x` et `y` sont omis sans estimation. Dans ce cas, `width` et `height` mesurent le SVG extrait et non sa position dans le PDF. Vérifiez `schemaVersion` et `placementStatus` avant de superposer l’objet au PDF.
>   ```json
>   {"id":2,"kind":"math","artifact":"svg/objects/math-000002.svg","sourceFile":"main.tex","sourceLine":20,"placementStatus":"unknown","width":10,"height":5}
>   ```

## Envoyer le ZIP {#zipアップロード}

Ce point de terminaison envoie un ZIP à une tâche réservée avec l’ancien parcours. Pour des sources préparées séparément, utilisez `PUT /api/v1/sources/{sourceId}/content`.

```http
PUT /api/v1/jobs/{jobId}/source
Authorization: Bearer <UPLOAD_TICKET>
Content-Type: application/zip
Content-Length: <ZIP size in bytes>
```

## États d’une tâche {#ジョブ状態}

| État | Signification | Action du client |
| --- | --- | --- |
| `reserved` / `uploading` | Réservée ou en cours d’envoi | Envoyer le ZIP avant expiration |
| `queued` / `validating` / `running` | En attente, validation ou compilation | Espacer les consultations |
| `succeeded` | Réussite | Télécharger le PDF et les fichiers nécessaires |
| `failed` / `timeout` / `rejected` | Échec, délai dépassé ou rejet | Examiner les erreurs |
| `canceled` | Annulée | Créer une tâche si nécessaire |
| `deleting` / `deleted` / `expired` | Suppression en cours, supprimée ou expirée | Créer une tâche si nécessaire |

**Conservation et protection des téléchargements en cours**
Une fois `ARTIFACT_RETENTION_HOURS` écoulé (24 heures par défaut) depuis la fin de la tâche ou sa dernière mise à jour si l’heure de fin manque pour une ancienne tâche, aucun nouveau téléchargement ne peut commencer, même s’il reste des fichiers à nettoyer. Cette règle s’applique au web, à l’API, au moteur de rendu et à Remote MCP. Les téléchargements, récupérations de ZIP et lectures MCP commencés dans les délais renouvellent leur protection contre la suppression uniquement pendant le transfert des données. Elle est libérée à la fin ou à la déconnexion. Après une interruption anormale, elle expire 5 minutes après son dernier renouvellement. Si le renouvellement échoue, le transfert est interrompu sans réactiver de fichiers expirés.

## Erreurs courantes {#共通エラー}

```json
{ "error": { "code": "ERROR_CODE", "message": "Description", "requestId": "Optional" } }
```

| État HTTP | Signification | Quand réessayer |
| --- | --- | --- |
| `400` | Entrée, en-têtes ou contenu ZIP incorrects | Corriger les données avant l’envoi |
| `401` / `403` | Jeton non valide, expiré ou de portée insuffisante | Vérifier les identifiants et permissions |
| `404` / `410` | Tâche ou fichier absent, tâche appartenant à une autre clé ou sources expirées | Créer une tâche si nécessaire |
| `409` | État incompatible ou conflit de `Idempotency-Key` | Consulter l’état actuel |
| `429` / `503` | Limite de fréquence, manque de capacité, file pleine ou maintenance | Attendre avant de réessayer |

## Exemple avec curl {#curlの例}

Cet exemple complet pour Bash sous Linux réserve les sources, envoie `source.zip`, interroge l’état toutes les 2 secondes jusqu’à 60 fois puis enregistre le PDF. Exécutez-le dans le dossier du ZIP. Il nécessite `curl`, `jq`, `sha256sum` et `uuidgen`. Pour un service auto-hébergé, modifiez `base`.

> [!DETAILS] Envoyer un ZIP et télécharger le PDF
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

Si la tâche est encore en attente après 60 consultations, utilisez le `jobId` affiché pour consulter la même tâche plus tard. Si `jobTicket` expire, appelez `POST /api/v1/job-tickets/{jobId}` avec la clé d’API ayant créé la tâche. Les exemples suivants couvrent la réservation et l’envoi du ZIP.

## PowerShell {#powershell}

> [!DETAILS] Exemple PowerShell
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

> [!DETAILS] Exemple JavaScript / TypeScript
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

> [!DETAILS] Exemple Python
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
