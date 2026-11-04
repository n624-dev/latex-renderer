export function installLanHttpsAuthorityRelease(
  source: string,
  options?: { rootDirectory?: string; uid?: number },
): Promise<Readonly<{ version: string; commit: string; reused: boolean }>>;
