export const defaultMaxUserActiveJobs = 20;
export const defaultSourceOrphanRetentionMinutes = 60;

export const runtimeSettingKeys = [
  "max_queue_length",
  "max_user_storage_bytes",
  "max_user_active_jobs",
  "source_orphan_retention_minutes",
] as const;

export type RuntimeSettingKey = (typeof runtimeSettingKeys)[number];

export function runtimeSettingDefinitions(limits: {
  maxQueueLength: number;
  maxUserStorageBytes: number;
}) {
  return {
    max_queue_length: {
      unit: "jobs",
      minimum: 1,
      maximum: 10_000,
      fallback: limits.maxQueueLength,
      environment: "MAX_QUEUE_LENGTH",
    },
    max_user_storage_bytes: {
      unit: "bytes",
      minimum: 100 * 1024 ** 2,
      maximum: 100 * 1024 ** 3,
      fallback: limits.maxUserStorageBytes,
      environment: "MAX_USER_STORAGE_BYTES",
    },
    max_user_active_jobs: {
      unit: "jobs",
      minimum: 1,
      maximum: 1_000,
      fallback: defaultMaxUserActiveJobs,
      environment: null,
    },
    source_orphan_retention_minutes: {
      unit: "minutes",
      minimum: 5,
      maximum: 1_440,
      fallback: defaultSourceOrphanRetentionMinutes,
      environment: null,
    },
  };
}
