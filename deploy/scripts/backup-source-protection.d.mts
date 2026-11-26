export function protectBackupSources<T extends { id: string }>(
  directory: string | undefined,
  snapshot: () => T[],
): Promise<{ sources: T[]; release(): Promise<void> }>;
export function claimUnprotectedSources<T>(
  directory: string | undefined,
  claim: (protectedSourceIds: string[]) => T[],
): Promise<T[]>;
