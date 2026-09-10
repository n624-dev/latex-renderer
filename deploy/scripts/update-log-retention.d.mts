export interface UpdateLogPolicy {
  maxBytes: number;
  reserveBytes: number;
  retentionMs: number;
  intervalMs: number;
}
export function updateLogPolicy(
  environment: Record<string, string | undefined>,
  maxOperationBytes: number,
): UpdateLogPolicy;
export function collectUpdateLogs(options: {
  root: string;
  policy: UpdateLogPolicy;
  activeId: () => string | null;
  now?: number;
}): Promise<{ deleted: number }>;
