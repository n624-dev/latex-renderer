import type { BigIntStatsFs } from "node:fs";
import type * as filesystem from "node:fs/promises";
import type { BackupRetentionRun } from "./backup-retention.mjs";

export function handleBackupRequest(
  message: string,
  options?: {
    directory?: string;
    databasePath?: string;
    receiptPath?: string;
    fs?: typeof filesystem;
    statfs?: (
      path: string,
      options: { bigint: true },
    ) => Promise<Pick<BigIntStatsFs, "bavail" | "bsize">>;
    now?: Date;
    log?: (line: string) => void;
    writeState?: (path: string, run: BackupRetentionRun) => Promise<void>;
  },
): Promise<unknown>;
