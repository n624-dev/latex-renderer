import { profileRecord } from "./profile-shape.mjs";
import { validateServerSetupReview } from "./runtime-review.mjs";
import { serverSetupInitialOwnerPlan } from "./authentication-review.mjs";
import { validateServerIngressTls } from "./ingress-tls.mjs";
import { Buffer } from "node:buffer";

function text(value, maximum, minimum = 1) {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    Buffer.byteLength(value) > maximum ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("Invalid initial credential value");
  return value;
}
/** Credentials are transient input, never part of format 4 or its summary.
 * Plain records are inspected before any property value is used.
 */
export function validateServerInitialInput(reviewInput, input) {
  const review = validateServerSetupReview(reviewInput);
  const model = profileRecord(input, "initial credentials", [
    "owner",
    "oidcClientSecret",
    "tls",
    "deploymentUser",
  ]);
  const owner = profileRecord(model.owner, "initial owner", [
    "displayName",
    "email",
    "loginName",
    "password",
    "subject",
  ]);
  const plan = serverSetupInitialOwnerPlan(review.deployment.authentication);
  const checked = { displayName: text(owner.displayName, 200).trim() };
  if (!checked.displayName) throw new Error("Initial owner name is required");
  if (Object.hasOwn(owner, "email")) {
    checked.email = text(owner.email, 320);
    if (!/^[^\s@]+@[^\s@]+$/.test(checked.email))
      throw new Error("Invalid owner email");
  }
  if (plan.bootstrapMethod === "password") {
    if (Object.hasOwn(owner, "subject"))
      throw new Error("Do not link an owner implicitly");
    checked.loginName = text(owner.loginName, 200);
    checked.password = text(owner.password, 1024, 12);
    // The runtime password service remains authoritative (including the
    // login-name/common-password checks); input bounds alone are not hashing.
  } else {
    if (Object.hasOwn(owner, "password") || Object.hasOwn(owner, "loginName"))
      throw new Error("Unexpected password credential");
    checked.subject = text(owner.subject, 500);
  }
  const auth = review.deployment.authentication.authentication;
  const result = { owner: checked };
  if (Object.hasOwn(model, "deploymentUser")) {
    result.deploymentUser = text(model.deploymentUser, 32);
    if (
      result.deploymentUser === "root" ||
      !/^[a-z_][a-z0-9_-]{0,31}$/.test(result.deploymentUser)
    )
      throw new Error("Prepared non-root deployment user required");
  }
  if (auth.backend === "native" && auth.oidcEnabled) {
    result.oidcClientSecret = text(model.oidcClientSecret, 4096, 16);
  } else if (Object.hasOwn(model, "oidcClientSecret"))
    throw new Error("OIDC is not enabled");
  const ingress = review.deployment.ingress;
  if (!ingress)
    throw new Error("Initial installation requires explicit ingress");
  if (ingress.mode === "standalone") {
    if (ingress.tlsProvider !== "custom")
      throw new Error("Automatic HTTPS is not implemented");
    const tls = profileRecord(model.tls, "initial TLS", [
      "certificate",
      "privateKey",
    ]);
    for (const [name, limit] of [
      ["certificate", 512 * 1024],
      ["privateKey", 16 * 1024],
    ]) {
      if (
        typeof tls[name] !== "string" ||
        Buffer.byteLength(tls[name]) > limit ||
        !tls[name]
      )
        throw new Error("Invalid TLS input size");
    }
    validateServerIngressTls(
      ingress,
      Buffer.from(tls.certificate),
      Buffer.from(tls.privateKey),
    );
    result.tls = { certificate: tls.certificate, privateKey: tls.privateKey };
  } else if (Object.hasOwn(model, "tls"))
    throw new Error("Cloudflare TLS is externally managed");
  return result;
}
export function validateServerIngressInput(reviewInput, input) {
  const review = validateServerSetupReview(reviewInput);
  const credentials = profileRecord(input, "ingress credentials", ["tls"]);
  const tls = profileRecord(credentials.tls, "TLS", [
    "certificate",
    "privateKey",
  ]);
  if (
    review.deployment.ingress?.mode !== "standalone" ||
    review.deployment.ingress.tlsProvider !== "custom"
  )
    throw new Error("Custom standalone HTTPS required");
  for (const [name, maximum] of [
    ["certificate", 512 * 1024],
    ["privateKey", 16 * 1024],
  ])
    if (
      typeof tls[name] !== "string" ||
      !tls[name] ||
      Buffer.byteLength(tls[name]) > maximum
    )
      throw new Error("Invalid TLS size");
  validateServerIngressTls(
    review.deployment.ingress,
    Buffer.from(tls.certificate),
    Buffer.from(tls.privateKey),
  );
  return { tls: { certificate: tls.certificate, privateKey: tls.privateKey } };
}
