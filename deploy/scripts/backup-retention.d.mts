import type * as filesystem from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";

export const archivePattern: RegExp;
export const backupRetentionSettingKey: "backup_retention_policy";
export const verificationReceiptPath: string;

export interface BackupRetentionPolicy {
  maxAgeDays: number;
  maxGenerations: number;
  maxTotalBytes: number;
}

export interface BackupArchive {
  name: string;
  bytes: number;
}

export interface BackupVerificationReceipt {
  archive: string;
  verifiedAt: string;
}

export interface ConfirmedBackupRetentionPolicy extends BackupRetentionPolicy {
  confirmedAt: string;
  confirmedBy: string;
}

export interface BackupRetentionRun {
  at: string;
  status: "succeeded" | "failed";
  deleted: string[];
  warnings: string[];
}

export interface BackupRetentionOptions {
  archives: BackupArchive[];
  policy: BackupRetentionPolicy | null;
  now: Date;
  latestVerifiedArchive?: string | null | undefined;
}

export function planBackupRetention(options: BackupRetentionOptions): {
  configured: boolean;
  keep: string[];
  delete: string[];
  protected: string[];
  keptBytes: number;
  deletedBytes: number;
  warnings: string[];
};

export function backupRetentionCandidates(options: {
  archives: BackupArchive[];
  freeBytes: bigint | number;
  minFreeStorageBytes: number;
}): BackupRetentionPolicy | null;

export function readBackupRetentionPolicy(
  db: DatabaseSync,
):
  | { policy: ConfirmedBackupRetentionPolicy; warning: null }
  | { policy: null; warning: "POLICY_INVALID" | null };

export function readVerificationReceipt(
  path: string,
  options?: { expectedUid?: number | undefined },
): Promise<BackupVerificationReceipt | null>;

export function applyBackupRetention(
  options: Omit<BackupRetentionOptions, "archives"> & { directory: string },
): Promise<
  ReturnType<typeof planBackupRetention> & {
    deleted: string[];
    alreadyAbsent: string[];
  }
>;

export function runPostBackupRetention(options: {
  databasePath: string;
  directory: string;
  receiptPath?: string;
  statePath?: string | null;
  now?: Date;
  fs?: typeof filesystem;
  writeState?: (path: string, run: BackupRetentionRun) => Promise<void>;
  lockTimeoutSeconds?: number;
  log?: (line: string) => void;
}): Promise<BackupRetentionRun>;
