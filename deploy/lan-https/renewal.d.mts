import type { LanHttpsAuthorityTransport } from "./authority-client.mjs";
export function lanHttpsAcmeCertificateId(
  certificate: string | Buffer,
): string | null;
export interface LanHttpsRenewalPlan {
  readonly ari: boolean;
  readonly renewAt: number;
  readonly certificateId: string | null;
}
export function planLanHttpsRenewal(options: {
  certificate: string;
  directoryUrl: string;
  now?: number;
  random?: (maximum: number) => number;
  transport?: LanHttpsAuthorityTransport;
}): Promise<Readonly<LanHttpsRenewalPlan>>;
