export interface AuditCheckpoint {
  createdAt: string;
  id: string;
}

export function readAuditCheckpoint(path: string): Promise<AuditCheckpoint>;

export function writeAuditCheckpoint(
  path: string,
  checkpoint: AuditCheckpoint,
): Promise<void>;
