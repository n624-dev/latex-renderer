// Pure, secret-free server configuration core. Importing does not read host
// files/environment, open listeners, contact providers or apply configuration.
// Discovery I/O is explicit and shared with runtime; importing still does none.
export {
  SERVER_RUNTIME_LIMITS,
  validateServerRuntimeReview,
  importServerRuntimeReview,
  serverRuntimeReviewEnvironment,
  validateServerSetupReview,
  importServerSetupReview,
  serverSetupReviewEnvironment,
} from "./runtime-review.mjs";
export {
  serverOidcDiscoveryUrl,
  validateServerOidcMetadata,
  discoverServerOidcProvider,
} from "./oidc-discovery.mjs";
export {
  reviewServerSetupReadiness,
  checkServerSetupOidc,
} from "./setup-readiness.mjs";
export {
  INGRESS_PROFILE_KEYS,
  serverIngressFromEnvironment,
  validateServerIngressReview,
  serverIngressReviewEnvironment,
  serverIngressContainsAddress,
} from "./ingress-review.mjs";
export { validateServerIngressTls } from "./ingress-tls.mjs";
export {
  renderServerIngressNginx,
  SERVER_INGRESS_TLS_PATHS,
} from "./ingress-nginx.mjs";
export {
  importServerSetupDeploymentReview,
  validateServerSetupDeploymentReview,
  serverSetupDeploymentReviewEnvironment,
} from "./deployment-review.mjs";
export {
  parseEnvironmentFile,
  validateProfileValues,
} from "./production-profile.mjs";
export {
  importServerSetupProfile,
  validateServerSetupProfile,
  serverSetupProfileEnvironment,
} from "./profile-model.mjs";
export {
  browserAuthenticationFromMode,
  parseBrowserAuthenticationSelection,
  validateBrowserAuthenticationSelection,
  isBrowserAuthenticationMethodEnabled,
  browserAuthenticationRequirements,
  legacyBrowserAuthenticationMode,
} from "./browser-auth-selection.mjs";
export {
  importServerSetupAuthenticationReview,
  migrateServerSetupAuthenticationReview,
  validateServerSetupAuthenticationReview,
  serverSetupAuthenticationReviewEnvironment,
  serverSetupInitialOwnerPlan,
  productionAuthenticationPlan,
} from "./authentication-review.mjs";
