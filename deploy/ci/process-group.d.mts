export function runCiProcessGroup(
  command: string,
  args: readonly string[],
  options?: { timeoutMs?: number; graceMs?: number },
): Promise<void>;
