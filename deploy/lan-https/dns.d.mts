export interface LanHttpsDnsConfig {
  domain: string;
  nameserver: string;
  caaIssuers?: readonly string[];
  challengeValues: (name: string) => readonly string[];
}
export type LanHttpsDnsResponder = (
  packet: Buffer,
  transport?: "udp" | "tcp",
) => Buffer | null;
export function createLanHttpsDnsResponder(
  config: LanHttpsDnsConfig,
): LanHttpsDnsResponder;
export function startLanHttpsDnsServer(options: {
  host: string;
  port: number;
  respond: LanHttpsDnsResponder;
  maxTcpConnections?: number;
  rateLimit?: Readonly<LanHttpsRateLimit>;
}): Promise<Readonly<{ port: number; close: () => Promise<void> }>>;
import type { LanHttpsRateLimit } from "./rate-limit.mjs";
