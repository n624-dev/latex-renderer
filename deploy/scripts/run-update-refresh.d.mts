export function runUpdateRefresh(options: {
  socketPath: string;
  token: string;
  maximumWaitMs: number;
  pollMs: number;
}): Promise<void>;
