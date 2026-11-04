export interface LanHttpsRateLimit {
  allow(key: string): boolean;
  readonly sourceCount: number;
}
export function createLanHttpsRateLimit(options?: {
  maxKeys?: number;
  requestsPerKey?: number;
  requestsTotal?: number;
  windowMs?: number;
  now?: () => number;
}): Readonly<LanHttpsRateLimit>;
