export interface ValidatedProductionProfile {
  authMode: "cloudflare-access" | "oidc" | "password";
  deploymentMode: "cloudflare" | "standalone";
  publicOrigin: string;
}

export function parseEnvironmentFile(contents: string): Map<string, string>;

export function validateProfileValues(
  values: ReadonlyMap<string, string>,
): ValidatedProductionProfile;
