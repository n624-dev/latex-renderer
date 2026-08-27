export function verifyGhcrWriteAccess(options: {
  repository: string;
  actor: string;
  token: string;
  fetchImpl?: typeof fetch;
}): Promise<void>;
