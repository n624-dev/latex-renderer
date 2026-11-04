import type {
  LanHttpsAuthorityPolicy,
  LanHttpsProvider,
} from "../../packages/server-setup-core/src/lan-https.mjs";
export function readLanHttpsBytes(
  path: string,
  options?: { secret?: boolean; maximumBytes?: number },
): Buffer;
export function readLanHttpsConfiguration(
  path: string,
  options?: { secret?: boolean; maximumBytes?: number },
): unknown;
export interface LanHttpsAuthorityConfiguration {
  readonly format: 1;
  readonly role: "authority";
  readonly policy: LanHttpsAuthorityPolicy;
  readonly stateDirectory: string;
  readonly http: Readonly<{
    address: string;
    port: number;
    trustLoopbackProxy: boolean;
  }>;
  readonly dns: Readonly<{
    listeners: readonly Readonly<{ address: string; port: number }>[];
    nameserver: string;
    caaIssuers: readonly string[];
  }>;
  readonly issuers: readonly Readonly<{
    id: string;
    directoryUrl: string;
    newAccountUrl: string;
    eabFile?: string;
  }>[];
  readonly keyless: Readonly<{ binary?: string; bundleFile: string }> | null;
}
export function validateLanHttpsAuthorityConfiguration(
  input: unknown,
  options?: { allowEphemeral?: boolean },
): Readonly<LanHttpsAuthorityConfiguration>;
export interface LanHttpsClientConfiguration {
  readonly format: 1;
  readonly role: "client";
  readonly provider: LanHttpsProvider;
  readonly stateDirectory: string;
  readonly issuerId: string;
  readonly termsAccepted: boolean;
  readonly allowedNetworks: readonly string[];
  readonly invitationFile?: string;
}
export function validateLanHttpsClientConfiguration(
  input: unknown,
): Readonly<LanHttpsClientConfiguration>;
