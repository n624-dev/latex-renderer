# API authentication

| Surface | Credential |
|---|---|
| `POST /api/v1/render-tickets` | long-lived `lrk_` render key |
| `POST /api/v1/source-tickets` | long-lived `lrk_` render key |
| `POST /api/v1/job-tickets/:jobId` | long-lived `lrk_` render key |
| `PUT /api/v1/sources/:sourceId/content` | short-lived Source upload ticket |
| `PUT /api/v1/jobs/:jobId/source` (legacy one-Job upload flow) | short-lived Job upload ticket |
| status/download/cancel/delete for `/api/v1/jobs/:jobId/*` | short-lived job ticket |
| `/admin/api/v1/session` and first-login claim | Cloudflare Access JWT; claim also requires CSRF and an active unlinked email invitation |
| Other `/admin/api/v1/*` routes in browser | Cloudflare Access JWT plus linked DB owner/admin role and CSRF header for mutations |
| `/admin/api/v1/*` from Admin CLI | Access service token plus `lra_` admin key |
| Internal API | Private Workers VPC Service binding plus application-layer `lrk_` authentication; never a public client endpoint |

The reusable Source flow separates long-lived authorization from upload capability: the API key reserves or reuses a Source through `POST /api/v1/source-tickets`, and only the returned short-lived Source upload ticket may write that reserved Source through `PUT /api/v1/sources/:sourceId/content`. Once the Source is ready, the API key creates Jobs from `sourceId + entrypoint`; Job operations use the short-lived job ticket.

The legacy render-ticket flow remains compatible: `POST /api/v1/render-tickets` with ZIP size/SHA-256 reserves a Job and returns a Job-scoped upload ticket for `PUT /api/v1/jobs/:jobId/source`.

API keys are HMAC-SHA-256 protected with a server-side pepper. Tickets include subject security versions, are revalidated against account/key state, and support JTI/KID revocation. Upload tickets are scoped to the reserved Source or Job and must not be reused as general API credentials.
