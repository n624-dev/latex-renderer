export function installManagerTmpfiles(
  directory?: string,
  apply?: (path: string) => unknown | Promise<unknown>,
): Promise<void>;
