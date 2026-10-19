export interface ArtifactAvailability {
  retentionHours?: number;
  now?: number;
}

export function artifactRetentionExpiresAt(
  terminalAt: string,
  hours = 24,
): string {
  const start = Date.parse(terminalAt);
  validate(hours, start);
  return new Date(start + hours * 3_600_000).toISOString();
}

export function artifactAvailabilityCutoff({
  retentionHours = 24,
  now = Date.now(),
}: ArtifactAvailability = {}): string {
  validate(retentionHours, now);
  return new Date(now - retentionHours * 3_600_000).toISOString();
}

function validate(hours: number, time: number): void {
  if (!Number.isSafeInteger(hours) || hours <= 0 || !Number.isFinite(time))
    throw new Error("Invalid artifact retention policy");
}

// A staged Job may expose only its committed PDF generation while SVG runs.
// Retention starts at PDF publication and is never renewed by an SVG retry.
export const ARTIFACT_AVAILABLE_SQL =
  "(j.status IN ('succeeded','failed','timeout','canceled','rejected') OR (j.status IN ('queued','validating','running') AND EXISTS(SELECT 1 FROM job_output_stages p WHERE p.job_id=j.id AND p.pdf_status='succeeded'))) AND COALESCE((SELECT p.pdf_completed_at FROM job_output_stages p WHERE p.job_id=j.id AND p.pdf_status='succeeded'),j.completed_at,j.updated_at)>? AND (a.relative_path NOT LIKE 'svg/%' OR NOT EXISTS(SELECT 1 FROM job_output_stages p WHERE p.job_id=j.id) OR a.storage_generation=(SELECT p.svg_generation FROM job_output_stages p WHERE p.job_id=j.id))";
