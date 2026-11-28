import type { DatabaseSync } from "node:sqlite";

export const archivePattern: RegExp;
export const backupRetentionSettingKey: "backup_retention_policy";

export interface BackupRetentionPolicy {
  maxAgeDays: number;
  maxGenerations: number;
  maxTotalBytes: number;
}

export interface BackupRetentionOptions {
  archives: { name: string; bytes: number }[];
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

export function readBackupRetentionPolicy(
  db: DatabaseSync,
):
  | { policy: BackupRetentionPolicy; warning: null }
  | { policy: null; warning: "POLICY_INVALID" | null };

export function readVerificationReceipt(
  path: string,
  options?: { expectedUid?: number | undefined },
): Promise<{ archive: string; verifiedAt: string } | null>;

export function applyBackupRetention(
  options: Omit<BackupRetentionOptions, "archives"> & { directory: string },
): Promise<
  ReturnType<typeof planBackupRetention> & {
    deleted: string[];
    alreadyAbsent: string[];
  }
>;
