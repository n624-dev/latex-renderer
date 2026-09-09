export function prepareApplicationDatabase(
  path: string,
  options: { uid: number; gid: number; createOnly?: boolean },
): Promise<void>;
export function applicationDatabaseIdentity(): { uid: number; gid: number };
