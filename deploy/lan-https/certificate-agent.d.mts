import type { createLanHttpsAuthorityClient } from "./authority-client.mjs";
import type { LanHttpsAcmeDriver } from "./acme.mjs";
import type { planLanHttpsRenewal } from "./renewal.mjs";
export interface LanHttpsCertificateAgentResult {
  readonly status: "deferred" | "issued";
  readonly certificateAvailable: boolean;
  readonly nextAttemptAt: number | null;
  readonly reason?: "scheduled" | "retry_scheduled";
  readonly cleanupPending?: number;
}
export function runLanHttpsCertificateAgent(options: {
  root: string;
  provider: unknown;
  issuerId: string;
  termsAccepted: boolean;
  invitationCode?: string;
  now?: () => number;
  authorityFactory?: typeof createLanHttpsAuthorityClient;
  clientFactory?: (options: {
    directoryUrl: string;
    accountKey: Buffer | string;
    accountUrl?: string;
  }) => Promise<LanHttpsAcmeDriver>;
  renewalPlanner?: typeof planLanHttpsRenewal;
  trustedCertificates?: readonly string[];
}): Promise<Readonly<LanHttpsCertificateAgentResult>>;
