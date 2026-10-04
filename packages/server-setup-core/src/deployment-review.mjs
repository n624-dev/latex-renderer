import {
  parseEnvironmentFile,
  validateProfileValues,
} from "./production-profile.mjs";
import {
  importServerSetupAuthenticationReview,
  validateServerSetupAuthenticationReview,
  serverSetupAuthenticationReviewEnvironment,
} from "./authentication-review.mjs";
import {
  INGRESS_PROFILE_KEYS,
  serverIngressFromEnvironment,
  validateServerIngressReview,
  serverIngressReviewEnvironment,
} from "./ingress-review.mjs";
import { profileRecord } from "./profile-shape.mjs";

// This aggregate preserves authentication and explicit ingress together. A
// legacy import stays unreviewed (null), never inventing an exposure policy.
export function importServerSetupDeploymentReview(contents) {
  const values = parseEnvironmentFile(contents);
  validateProfileValues(values);
  const ingress = serverIngressFromEnvironment(values);
  for (const key of INGRESS_PROFILE_KEYS) values.delete(key);
  const authentication = importServerSetupAuthenticationReview(
    environmentContents(values),
  );
  return validateServerSetupDeploymentReview({
    format: 3,
    authentication,
    ingress,
  });
}

export function validateServerSetupDeploymentReview(input) {
  const model = profileRecord(input, "deployment review", [
    "format",
    "authentication",
    "ingress",
  ]);
  if (model.format !== 3 || !Object.hasOwn(model, "ingress"))
    throw new Error(
      "Deployment review requires format 3 and explicit ingress (or null for legacy)",
    );
  const authentication = validateServerSetupAuthenticationReview(
    model.authentication,
  );
  const ingress =
    model.ingress === null ? null : validateServerIngressReview(model.ingress);
  if (
    ingress &&
    (ingress.mode !== authentication.deployment.mode ||
      ingress.publicOrigin !== authentication.deployment.publicOrigin)
  )
    throw new Error("Authentication and ingress deployment/origin must match");
  return Object.freeze({ format: 3, authentication, ingress });
}

export function serverSetupDeploymentReviewEnvironment(input) {
  const review = validateServerSetupDeploymentReview(input);
  const values = serverSetupAuthenticationReviewEnvironment(
    review.authentication,
  );
  if (review.ingress)
    for (const [key, value] of serverIngressReviewEnvironment(review.ingress))
      values.set(key, value);
  // Automatic HTTPS may be reviewed, but cannot become active configuration.
  validateProfileValues(values);
  return values;
}

function environmentContents(values) {
  return [...values].map(([key, value]) => `${key}=${value}`).join("\n");
}
