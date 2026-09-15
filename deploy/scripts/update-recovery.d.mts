export interface RecoveryPolicy {
  maxBytes: number;
  minFreeBytes: number;
  retainCount: number;
  retainHours: number;
  maxEntries: number;
}
export interface RecoveryPoint {
  format: number;
  id: string;
  createdAt: number;
  release: { version: string; commit: string };
  schema: number;
  /** Explicit fields are absent in historical format-1 recovery points. */
  sqliteUserVersion?: number;
  applicationSchemaVersion?: number | null;
  storageIncluded: boolean;
  files: number;
  archive: { bytes: number; sha256: string };
}
export function recoveryPolicy(value?: unknown): RecoveryPolicy;
export class RecoveryStore {
  root: string;
  policy: RecoveryPolicy;
  constructor(root: string, policy?: RecoveryPolicy);
  initialize(): Promise<void>;
  atomic(name: string, value: unknown): Promise<void>;
  sync(): Promise<void>;
  points(): Promise<RecoveryPoint[]>;
  remove(path: string): Promise<void>;
  discard(id: string): Promise<void>;
  usage(): Promise<number>;
  collect(options?: {
    protectedId?: string | null;
    now?: number;
    additionalBytes?: number;
  }): Promise<void>;
  create(options: {
    database: string;
    storage: string;
    recipient: string;
    identity: string;
    release: { version: string; commit: string };
    now?: number;
  }): Promise<RecoveryPoint>;
}
