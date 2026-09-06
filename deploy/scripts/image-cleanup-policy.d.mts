export function imageCleanupPolicy(
  environment: Record<string, string | undefined>,
): {
  intervalHours: number;
  retentionHours: number;
  cacheMaxGiB: number;
};
export function eligibleManagedImage(
  info: {
    Id?: string;
    Created?: string;
    Config?: { Labels?: Record<string, string> };
  },
  protectedIds: Set<string>,
  retentionHours: number,
  now?: number,
): boolean;
