export function retryCiMutation<T>(
  action: () => T | Promise<T>,
  options?: { attempts?: number; wait?: (ms: number) => Promise<unknown> },
): Promise<T>;
