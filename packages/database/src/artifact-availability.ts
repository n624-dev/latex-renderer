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

// Only completed generations are downloadable. An active transfer admitted
// before the deadline is protected independently by its renewable lease.
export const ARTIFACT_AVAILABLE_SQL =
  "j.status IN ('succeeded','failed','timeout','canceled','rejected') AND COALESCE(j.completed_at,j.updated_at)>?";
