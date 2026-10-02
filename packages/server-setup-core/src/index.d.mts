export interface ValidatedProductionProfile {
  authMode: "cloudflare-access" | "oidc" | "password";
  deploymentMode: "cloudflare" | "standalone";
  publicOrigin: string;
}

export type BrowserAuthenticationSelection =
  | Readonly<{ backend: "cloudflare-access" }>
  | Readonly<{
      backend: "native";
      passwordEnabled: boolean;
      oidcEnabled: boolean;
      oidcDisplayName?: string;
    }>;

export function browserAuthenticationFromMode(
  mode: unknown,
): BrowserAuthenticationSelection;
export function parseBrowserAuthenticationSelection(
  values: ReadonlyMap<string, string>,
): BrowserAuthenticationSelection;
export function validateBrowserAuthenticationSelection(
  input: unknown,
): BrowserAuthenticationSelection;
export function isBrowserAuthenticationMethodEnabled(
  selection: BrowserAuthenticationSelection,
  method: string,
): boolean;
export interface BrowserAuthenticationRequirements {
  readonly passwordEnabled: boolean;
  readonly oidcEnabled: boolean;
  readonly bootstrapMethod: "password" | "oidc" | "cloudflare-access";
  readonly followUpOidcRegistration: boolean;
}
export function browserAuthenticationRequirements(
  input: unknown,
): Readonly<BrowserAuthenticationRequirements>;
/** Validated non-secret host plan; the new-config rollout gate still applies. */
export interface ProductionAuthenticationPlan extends BrowserAuthenticationRequirements {
  readonly deploymentMode: "cloudflare" | "standalone";
  readonly publicOrigin: string;
  readonly authMode: "cloudflare-access" | "password" | "oidc" | "native";
  readonly externalIssuer: string;
}
export function productionAuthenticationPlan(
  values: ReadonlyMap<string, string>,
): Readonly<ProductionAuthenticationPlan>;
/** Rollout gate for adapters that still require the existing AUTH_MODE profile. */
export function legacyBrowserAuthenticationMode(
  values: ReadonlyMap<string, string>,
): "cloudflare-access" | "password" | "oidc";

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

export type ServerSetupAuthenticationReviewMethod =
  | Readonly<{
      backend: "cloudflare-access";
      issuer: string;
      adminAudience: string;
      remoteMcpAudience: string;
    }>
  | Readonly<{
      backend: "native";
      passwordEnabled: true;
      oidcEnabled: false;
    }>
  | Readonly<{
      backend: "native";
      passwordEnabled: boolean;
      oidcEnabled: true;
      oidc: Readonly<{
        issuer: string;
        clientId: string;
        allowedAlgorithms: readonly string[];
        displayName?: string;
      }>;
    }>;

/** Format 2 is review-only until all host/runtime consumers are integrated. */
export interface ServerSetupAuthenticationReview {
  readonly format: 2;
  readonly deployment: ServerSetupProfile["deployment"];
  readonly authentication: ServerSetupAuthenticationReviewMethod;
}
export function importServerSetupAuthenticationReview(
  contents: string,
): ServerSetupAuthenticationReview;
/** Explicit conversion of validated format-1 JSON; no installed file writes. */
export function migrateServerSetupAuthenticationReview(
  input: unknown,
): ServerSetupAuthenticationReview;
export function validateServerSetupAuthenticationReview(
  input: unknown,
): ServerSetupAuthenticationReview;
/** Non-secret profile keys only; the output still fails the host rollout gate. */
export function serverSetupAuthenticationReviewEnvironment(
  input: unknown,
): Map<string, string>;
export function serverSetupInitialOwnerPlan(input: unknown): Readonly<{
  bootstrapMethod: "password" | "oidc" | "cloudflare-access";
  followUpOidcRegistration: boolean;
}>;
