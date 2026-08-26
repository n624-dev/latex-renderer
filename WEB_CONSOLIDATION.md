# Web and API consolidation

## Canonical URLs

| Purpose           | URL                                       |
| ----------------- | ----------------------------------------- |
| Public Web        | `https://latex.example.com/`              |
| Administrator Web | `https://latex.example.com/admin/`        |
| Render API        | `https://latex.example.com/api/v1/`       |
| Administrator API | `https://latex.example.com/admin/api/v1/` |
| Downloads         | `https://latex.example.com/downloads/`    |

## Compatibility release

API clients use `redirect: "error"`, so API migration is implemented with dual routes rather than redirects:

- Gateway keeps `/v1/render-tickets` and `/v1/jobs/:jobId/ticket` temporarily.
- Renderer API keeps `/v1/jobs/*` temporarily.
- Admin API keeps `/admin/v1/*` temporarily.
- GET-only `/client/*` paths redirect to `/downloads/windows/*`.

The canonical ticket-renewal route is `/api/v1/job-tickets/:jobId`. This prefix is necessary because Cloudflare Worker Routes cannot selectively match an infix wildcard such as `/api/v1/jobs/*/ticket` without also routing uploads and downloads through the Worker.

## Removal sequence

1. Release A: deploy canonical and legacy routes together.
2. Release B: verify all CLI/MCP/Admin CLI installations use `LATEX_RENDER_BASE_URL` and log legacy use.
3. Release C: remove old hostnames, Worker custom domain, and legacy route aliases.

Do not remove the old routes in the same release that introduces the consolidated origin.
