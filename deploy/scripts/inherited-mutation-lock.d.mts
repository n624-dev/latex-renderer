export interface InheritedMutationLock {
  fd: number;
  release(): Promise<void>;
}
export function acquireInheritedMutationLockForPath(
  path: string,
): Promise<InheritedMutationLock>;
export function acquireInheritedMutationLock(): Promise<InheritedMutationLock>;
export function withInheritedMutationLock<T>(
  lock: InheritedMutationLock | null,
  action: () => T,
): T;
export function inheritedMutationStdio(
  streams: ("ignore" | "pipe" | "inherit" | number)[],
): ("ignore" | "pipe" | "inherit" | number)[];
