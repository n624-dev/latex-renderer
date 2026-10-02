export interface ValidatedProductionProfile {
  authMode: "cloudflare-access" | "oidc" | "password";
  deploymentMode: "cloudflare" | "standalone";
  publicOrigin: string;
}

export type ServerSetupAuthentication =
  | Readonly<{ mode: "password" }>
  | Readonly<{
      mode: "oidc";
      issuer: string;
      clientId: string;
      allowedAlgorithms: readonly string[];
    }>
  | Readonly<{
      mode: "cloudflare-access";
      issuer: string;
      adminAudience: string;
      remoteMcpAudience: string;
    }>;

/** Transitional model of existing production profiles, not a completed wizard. */
export interface ServerSetupProfile {
  readonly format: 1;
  readonly deployment: Readonly<{
    mode: "cloudflare" | "standalone";
    publicOrigin: string;
    rendererPublicUrl: string;
    adminApiUrl?: string;
  }>;
  readonly authentication: ServerSetupAuthentication;
}

export function parseEnvironmentFile(contents: string): Map<string, string>;
export function validateProfileValues(
  values: ReadonlyMap<string, string>,
): ValidatedProductionProfile;
export function importServerSetupProfile(contents: string): ServerSetupProfile;
export function validateServerSetupProfile(input: unknown): ServerSetupProfile;
/** Returns only profile keys; never replace a full renderer.env with this map. */
export function serverSetupProfileEnvironment(
  input: unknown,
): Map<string, string>;
