export function normalizeLanHttpsDomain(input: unknown): string;
export function lanHttpsHostname(address: string, domain: string): string;
export function lanHttpsAddress(hostname: string, domain: string): string;
export function lanHttpsOrigin(
  address: string,
  domain: string,
  port?: number,
): string;
export function validateLanHttpsServerOrigin(input: unknown): string;
export interface LanHttpsProvider {
  readonly format: 1;
  readonly provider: "akebi-keyless" | "akebi-local-acme";
  readonly serverOrigin: string;
  readonly lanDomain: string;
  readonly address: string;
  readonly port: number;
  readonly keylessFallback: boolean;
  readonly publicOrigin: string;
}
export function validateLanHttpsProvider(input: unknown): LanHttpsProvider;
export interface LanHttpsAuthorityLimits {
  readonly maxInstallations: number;
  readonly maxNonces: number;
  readonly maxNoncesPerInstallation: number;
  readonly nonceTtlMs: number;
  readonly maxChallenges: number;
  readonly maxChallengesPerInstallation: number;
  readonly challengeTtlMs: number;
  readonly maxInvites: number;
}
export const LAN_HTTPS_AUTHORITY_DEFAULTS: Readonly<LanHttpsAuthorityLimits>;
export interface LanHttpsAuthorityPolicy {
  readonly format: 1;
  readonly serverOrigin: string;
  readonly lanDomain: string;
  readonly registration: "open" | "invite";
  readonly limits: Readonly<LanHttpsAuthorityLimits>;
}
export function validateLanHttpsAuthorityPolicy(
  input: unknown,
): LanHttpsAuthorityPolicy;
export const LAN_HTTPS_COMMON: Readonly<{
  serverOrigin: string;
  lanDomain: string;
  issuerId: string;
}>;
export function lanHttpsInterfaceChoices(
  interfaces: unknown,
): readonly Readonly<{
  interfaceName: string;
  address: string;
  network: string;
}>[];
