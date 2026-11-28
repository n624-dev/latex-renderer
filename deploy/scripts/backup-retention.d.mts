export const archivePattern: RegExp;

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
