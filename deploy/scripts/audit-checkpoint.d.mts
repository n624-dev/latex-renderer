import type { DatabaseSync } from "node:sqlite";

export interface AuditCheckpoint {
  format: 3;
  databaseId: string;
  sequence: string;
  token: string;
}

export type ReadAuditCheckpoint =
  | AuditCheckpoint
  | { format: 0 }
  | { format: 1 | 2; createdAt: string; id: string };

export interface AuditDatabaseState {
  databaseId: string;
  highWater: string;
}

export function readAuditCheckpoint(path: string): Promise<ReadAuditCheckpoint>;
export function writeAuditCheckpoint(
  path: string,
  checkpoint: AuditCheckpoint,
): Promise<void>;
export function syncAuditDirectory(path: string): Promise<void>;
export function readAuditDatabaseState(
  database: DatabaseSync,
): AuditDatabaseState;
export function validateAuditCheckpoint(
  database: DatabaseSync,
  checkpoint: AuditCheckpoint,
  state?: AuditDatabaseState,
): AuditCheckpoint;
