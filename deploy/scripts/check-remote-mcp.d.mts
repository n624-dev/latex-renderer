export function checkRemoteMcp(
  origin: string,
  fetcher?: typeof fetch,
): Promise<{
  ok: boolean;
  checks: {
    stage: string;
    ok: boolean;
    status?: number;
    json?: boolean;
    reason?: string;
  }[];
}>;
