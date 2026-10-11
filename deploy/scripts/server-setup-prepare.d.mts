export const INITIAL_APPLICATION_UNITS: readonly string[];
export function prepareServerApplication(): Promise<void>;
export function prepareServerSetupMutationLock(): Promise<void>;
export function prepareRuntimeMutationLockForPath(
  path: string,
  identity: { rootUid: number; updaterUid: number; gid: number },
): Promise<void>;
