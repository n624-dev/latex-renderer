export interface MutationLock {
  release(): Promise<void>;
}

export function acquireMutationLockForPath(
  lockPath: string,
): Promise<MutationLock>;

export function acquireMutationLock(): Promise<MutationLock>;
