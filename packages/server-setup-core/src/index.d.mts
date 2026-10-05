export interface ValidatedProductionProfile {
  authMode: "cloudflare-access" | "oidc" | "password" | "native";
  deploymentMode: "cloudflare" | "standalone";
  publicOrigin: string;
}
export class ServerSetupSessionError extends Error {
  readonly code: string;
  constructor(code: string);
}
export interface ServerSetupSessionHost {
  current(this: void): unknown | Promise<unknown>;
  preview(this: void, review: ServerSetupReview): unknown | Promise<unknown>;
  apply(this: void, envelope: unknown): void | Promise<void>;
}
export interface ServerSetupSession {
  status(): Promise<{
    phase: string;
    review: ServerSetupReview;
    scope: "existing-prepared-host";
  }>;
  preview(
    input: unknown,
  ): Promise<{
    review: ServerSetupReview;
    readiness: ReturnType<typeof reviewServerSetupReadiness>;
    confirmation: string;
  }>;
  apply(token: unknown): Promise<{ phase: "complete" }>;
  close(): void;
}
export function createServerSetupSession(
  host: ServerSetupSessionHost,
  options?: { clock?: () => number; lifetimeMs?: number },
): ServerSetupSession;

export interface ServerRuntimeLimits {
  readonly maxUploadBytes: number;
  readonly maxExtractedBytes: number;
  readonly maxFileCount: number;
  readonly maxZipEntries: number;
  readonly maxOutputBytes: number;
  readonly maxOutputFileCount: number;
  readonly maxOutputDirectoryCount: number;
  readonly maxLogBytes: number;
  readonly maxSvgObjects: number;
  readonly maxSvgBytes: number;
  readonly maxSvgTotalBytes: number;
  readonly svgConversionTimeoutSeconds: number;
  readonly maxQueueLength: number;
  readonly maxUserStorageBytes: number;
  readonly minFreeStorageBytes: number;
  readonly jobTimeoutSeconds: number;
}
export interface ServerRuntimeReview {
  readonly databasePath: string;
  readonly storageRoot: string;
  readonly rendererImage: string;
  readonly limits: Readonly<ServerRuntimeLimits>;
}
export const SERVER_RUNTIME_LIMITS: Readonly<
  Record<keyof ServerRuntimeLimits, readonly [string, number, number?]>
>;
export interface ServerSetupReview {
  readonly format: 4;
  readonly deployment: ServerSetupDeploymentReview;
  readonly runtime: Readonly<ServerRuntimeReview>;
}
export function validateServerRuntimeReview(
  input: unknown,
): Readonly<ServerRuntimeReview>;
export function importServerRuntimeReview(
  contents: string,
): Readonly<ServerRuntimeReview>;
export function serverRuntimeReviewEnvironment(
  input: unknown,
): Map<string, string>;
export function validateServerSetupReview(
  input: unknown,
): Readonly<ServerSetupReview>;
export function importServerSetupReview(
  contents: string,
): Readonly<ServerSetupReview>;
export function serverSetupReviewEnvironment(
  input: unknown,
): Map<string, string>;

export type ServerIngressReview =
  | Readonly<{
      format: 1;
      mode: "cloudflare";
      publicOrigin: string;
      accessScope: "internet";
      tlsProvider: "cloudflare";
    }>
  | Readonly<{
      format: 1;
      mode: "standalone";
      publicOrigin: string;
      accessScope: "local" | "lan" | "internet";
      tlsProvider: "custom" | "automatic";
      listenAddress: string;
      allowedNetworks?: readonly string[];
    }>;
export const INGRESS_PROFILE_KEYS: readonly string[];
export function serverIngressFromEnvironment(
  values: ReadonlyMap<string, string>,
): ServerIngressReview | null;
export function validateServerIngressReview(
  input: unknown,
): ServerIngressReview;
/** Ingress keys ONLY. Merge with the matching auth/deployment profile, never replace a full EnvironmentFile. */
export function serverIngressReviewEnvironment(
  input: unknown,
): Map<string, string>;
export function serverIngressContainsAddress(
  network: string,
  address: string,
): boolean;
export function validateServerIngressTls(
  input: unknown,
  certificate: Buffer,
  privateKey: Buffer,
  now?: number,
): Readonly<{
  fingerprint256: string;
  expiresAt: string;
  publicOrigin: string;
}>;
export const SERVER_INGRESS_TLS_PATHS: Readonly<{
  certificate: string;
  privateKey: string;
}>;
export function renderServerIngressNginx(input: unknown): string;
export interface ServerSetupDeploymentReview {
  readonly format: 3;
  readonly authentication: ServerSetupAuthenticationReview;
  readonly ingress: ServerIngressReview | null;
}
export function importServerSetupDeploymentReview(
  contents: string,
): ServerSetupDeploymentReview;
export function validateServerSetupDeploymentReview(
  input: unknown,
): ServerSetupDeploymentReview;
/** Non-secret configuration ONLY, not an installed EnvironmentFile writer. */
export function serverSetupDeploymentReviewEnvironment(
  input: unknown,
): Map<string, string>;

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
/** Validated non-secret host plan for legacy and format-2 authentication. */
export interface ProductionAuthenticationPlan extends BrowserAuthenticationRequirements {
  readonly deploymentMode: "cloudflare" | "standalone";
  readonly publicOrigin: string;
  readonly authMode: "cloudflare-access" | "password" | "oidc" | "native";
  readonly externalIssuer: string;
}
export function productionAuthenticationPlan(
  values: ReadonlyMap<string, string>,
): Readonly<ProductionAuthenticationPlan>;
/** Legacy format-1 boundary; rejects new keys instead of losing methods. */
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

/** Format 2 preserves all configured authentication methods. */
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
/** Non-secret profile keys only; never replace a complete EnvironmentFile. */
export function serverSetupAuthenticationReviewEnvironment(
  input: unknown,
): Map<string, string>;
export function serverSetupInitialOwnerPlan(input: unknown): Readonly<{
  bootstrapMethod: "password" | "oidc" | "cloudflare-access";
  followUpOidcRegistration: boolean;
}>;
export interface ServerOidcMetadata {
  readonly issuer: string;
  readonly authorization_endpoint: string;
  readonly token_endpoint: string;
  readonly jwks_uri: string;
}
export interface ServerOidcDiscoveryOptions {
  readonly fetchImpl?: typeof fetch;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}
export function serverOidcDiscoveryUrl(issuer: string): string;
export function validateServerOidcMetadata(
  issuer: string,
  input: unknown,
): Readonly<ServerOidcMetadata>;
export function discoverServerOidcProvider(
  issuer: string,
  options?: ServerOidcDiscoveryOptions,
): Promise<Readonly<ServerOidcMetadata>>;
export interface ServerSetupReadiness {
  readonly format: 1;
  readonly review: ServerSetupDeploymentReview | ServerSetupReview;
  readonly initialOwner: Readonly<{
    bootstrapMethod: "password" | "oidc" | "cloudflare-access";
    followUpOidcRegistration: boolean;
  }>;
  readonly requiredCredentialFiles: readonly Readonly<{
    id: string;
    path: string;
  }>[];
  readonly oidcDiscoveryRequired: boolean;
  readonly ingressStatus: "unreviewed" | "unsupported-automatic" | "reviewed";
  readonly readyForApply: false;
}
export function reviewServerSetupReadiness(
  input: unknown,
): Readonly<ServerSetupReadiness>;
export function checkServerSetupOidc(
  input: unknown,
  options?: ServerOidcDiscoveryOptions,
): Promise<
  Readonly<
    | { status: "not-required"; metadata: null }
    | { status: "checked"; metadata: Readonly<ServerOidcMetadata> }
  >
>;
