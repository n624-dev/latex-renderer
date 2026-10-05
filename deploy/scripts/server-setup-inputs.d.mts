export function cleanupServerSetupInputs(
  root: string,
  uid?: number,
  gid?: number,
  now?: number,
): Promise<{ removed: number }>;
