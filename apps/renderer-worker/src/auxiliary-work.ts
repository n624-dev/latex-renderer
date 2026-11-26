import type { RendererDatabase } from "@latex-renderer/database";
import { nowIso } from "@latex-renderer/shared";

const promotionDelayMs = 30_000;
type WorkKind = "inspection" | "preview" | "probe";

/** Claim the oldest eligible auxiliary item within the current resource limits. */
export function claimAuxiliaryWork(
  database: RendererDatabase,
  config: { workerId: string },
  options: { renderReady: boolean; allowPreview: boolean; allowProbe: boolean },
  timestamp = nowIso(),
) {
  if (!options.allowPreview && !options.allowProbe) return undefined;
  const oldest = database.raw.prepare(
    `SELECT 'inspection' AS kind, MIN(COALESCE(retry_at,requested_at)) AS since FROM pdf_inspections
       WHERE ? AND status='queued' AND expires_at>? AND (retry_at IS NULL OR retry_at<=?)
     UNION ALL SELECT 'preview', MIN(created_at) FROM job_preview_requests
       WHERE ? AND status='queued' AND attempt<3
     UNION ALL SELECT 'probe', MIN(requested_at) FROM document_probes
       WHERE ? AND status='queued' AND expires_at>?
     ORDER BY since, kind`,
  ).all(
    Number(options.allowPreview), timestamp, timestamp,
    Number(options.allowPreview),
    Number(options.allowProbe), timestamp,
  ) as { kind: WorkKind; since: string | null }[];

  const before = options.renderReady
    ? new Date(Date.parse(timestamp) - promotionDelayMs).toISOString()
    : timestamp;
  for (const { kind, since } of oldest) {
    if (since === null || since > before) continue;
    const claimed = database.transaction(() => {
      if (database.previews.busy()) return undefined;
      const owner = config.workerId;
      switch (kind) {
        case "inspection": {
          const request = database.pdfInspections.claim(owner, timestamp);
          return request ? { kind, request } as const : undefined;
        }
        case "preview": {
          const request = database.previews.claim(owner, timestamp);
          return request ? { kind, request } as const : undefined;
        }
        case "probe": {
          const request = database.documentProbes.claim(owner, timestamp);
          return request ? { kind, request } as const : undefined;
        }
      }
    });
    if (claimed) return claimed;
  }
  return undefined;
}
