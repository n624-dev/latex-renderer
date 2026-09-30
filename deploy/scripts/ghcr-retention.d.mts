import type {
  SpawnSyncOptionsWithStringEncoding,
  SpawnSyncOptions,
} from "node:child_process";
export interface RetentionOptions {
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  spawnImpl?: (
    command: string,
    args: string[],
    options: SpawnSyncOptions | SpawnSyncOptionsWithStringEncoding,
  ) => { status: number | null; stdout?: string };
  sleep?: (ms: number) => Promise<unknown>;
  now?: Date;
  log?: (record: Record<string, unknown>) => void;
  readManifestImpl?: (digest: string) => Promise<unknown>;
}
export function runGhcrRetention(options?: RetentionOptions): Promise<{
  event: string;
  dryRun: boolean;
  plannedVersions: number;
  alreadyAbsentVersions: number;
  weeklyAliases: number;
  deletedVersions: number;
  deletedUntaggedVersions: number;
  deletedLegacyRuntimeVersions: number;
  purgeLegacyRuntimes: boolean;
  onDemandRetentionDays: number;
  untaggedRetentionDays: number;
}>;
