import type { KeyObject } from "node:crypto";
import type { LanHttpsIdentityPublicKey } from "./proof.mjs";
import type { LanHttpsExternalAccountBinding } from "./eab.mjs";
export interface LanHttpsAuthorityTransportOptions {
  method: string;
  body?: Buffer;
  headers?: Readonly<Record<string, string>>;
}
export type LanHttpsAuthorityTransport = (
  url: URL,
  options: LanHttpsAuthorityTransportOptions,
) => Promise<{ status: number; body: unknown; retryAfter?: string }>;
export const requestLanHttpsAuthorityJson: LanHttpsAuthorityTransport;
export interface LanHttpsAuthorityClient {
  readonly installationId: string;
  readonly publicKey: Readonly<LanHttpsIdentityPublicKey>;
  metadata(): Promise<
    Readonly<{
      format: 1;
      serverOrigin: string;
      lanDomain: string;
      registration: "open" | "invite";
      proofAlgorithm: "Ed25519";
      issuers: readonly {
        id: string;
        directoryUrl: string;
        newAccountUrl: string;
        externalAccountRequired?: boolean;
      }[];
    }>
  >;
  enroll(
    invitationCode?: string,
  ): Promise<Readonly<{ installationId: string; created: boolean }>>;
  bindAcmeAccount(
    issuerId: string,
    publicKey: unknown,
  ): Promise<Readonly<LanHttpsExternalAccountBinding> | null>;
  presentChallenge(
    hostname: string,
    value: string,
  ): Promise<Readonly<{ id: string; expiresAt: number }>>;
  removeChallenge(id: string): Promise<Readonly<{ removed: boolean }>>;
}
export function createLanHttpsAuthorityClient(options: {
  provider: unknown;
  identityKey: KeyObject | string | Buffer;
  transport?: LanHttpsAuthorityTransport;
}): Readonly<LanHttpsAuthorityClient>;
