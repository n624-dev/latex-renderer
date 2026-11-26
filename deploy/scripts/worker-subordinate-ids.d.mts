export function workerIdRange(
  contents: string,
  users: readonly string[],
  limits: { minimum: number; maximum: number },
): { first: number; last: number } | undefined;
