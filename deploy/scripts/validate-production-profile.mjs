#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { URL, pathToFileURL } from "node:url";

import {
  parseEnvironmentFile,
  productionAuthenticationPlan,
  browserAuthenticationRequirements,
  serverIngressFromEnvironment,
} from "../../packages/server-setup-core/src/index.mjs";
import {
  verifyProductionIngressTls,
  verifyIngressInterface,
} from "./server-ingress.mjs";
export {
  parseEnvironmentFile,
  validateProfileValues,
} from "../../packages/server-setup-core/src/index.mjs";

function groupId(name) {
  const line = execFileSync("getent", ["group", name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const gid = Number(line.split(":")[2]);
  if (!Number.isInteger(gid))
    throw new Error(`required group ${name} was not found`);
  return gid;
}

function assertSecureFile(path, options) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${options.label} must be a regular non-symlink file`);
  if (
    stat.uid !== 0 ||
    stat.gid !== options.gid ||
    (stat.mode & 0o777) !== options.mode
  )
    throw new Error(`${options.label} has unsafe ownership or permissions`);
  if (stat.size < options.minimumBytes || stat.size > options.maximumBytes)
    throw new Error(`${options.label} has an invalid size`);
}

function main() {
  if (process.geteuid?.() !== 0)
    throw new Error("validate-production-profile.mjs must run as root");
  if (process.argv[2] === "--plan-field") {
    if (process.argv.length !== 5)
      throw new Error("Invalid production plan field arguments");
    process.stdout.write(
      `${productionAuthPlanField(process.argv[4], process.argv[3])}\n`,
    );
    return;
  }
  // Do not deploy another release over an interrupted configuration cutover.
  // Even a committed-but-uncleaned journal requires explicit recovery first.
  try {
    lstatSync("/etc/latex-renderer/installation-transaction/journal.json");
    throw new Error("Recover the initial installation before deployment");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  try {
    lstatSync("/etc/latex-renderer/authentication-transaction/journal.json");
    throw new Error("Recover the authentication transaction before deployment");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const action = process.argv[3];
  if (
    process.argv.length !== (action === undefined ? 3 : 4) ||
    (action !== undefined && action !== "--profile-plan" && action !== "--plan")
  )
    throw new Error(
      "usage: validate-production-profile.mjs RENDERER_ENV_FILE [--profile-plan|--plan]",
    );
  const environmentPath = process.argv[2];
  const rendererGid = groupId("latex-renderer");
  assertSecureFile(environmentPath, {
    label: "renderer.env",
    gid: rendererGid,
    mode: 0o640,
    minimumBytes: 1,
    maximumBytes: 128 * 1024,
  });
  const values = parseEnvironmentFile(readFileSync(environmentPath, "utf8"));
  const profile = productionAuthenticationPlan(values);
  // Profile-only planning is used before generating a missing password pepper.
  // It validates the complete profile, but certifies no secret files.
  if (action !== "--profile-plan") {
    const ingress = serverIngressFromEnvironment(values);
    verifyProductionIngressTls(ingress, rendererGid);
    verifyIngressInterface(ingress);
    verifyProductionAuthSecrets(profile, rendererGid);
  }
  if (action !== undefined)
    process.stdout.write(`${JSON.stringify(profile)}\n`);
  else
    process.stdout.write(
      `Production profile verified: ${profile.deploymentMode}/${profile.authMode}\n`,
    );
}

export function verifyProductionAuthSecrets(profile, rendererGid) {
  if (profile.oidcEnabled) {
    const secretPath = "/etc/latex-renderer/secrets/oidc-client-secret";
    assertSecureFile(secretPath, {
      label: "OIDC client secret",
      gid: rendererGid,
      mode: 0o440,
      minimumBytes: 16,
      maximumBytes: 16 * 1024,
    });
    const length = readFileSync(secretPath, "utf8").trim().length;
    if (length < 16 || length > 4096)
      throw new Error("OIDC client secret has an invalid trimmed length");
  }
  if (profile.passwordEnabled) {
    assertSecureFile("/etc/latex-renderer/secrets/auth-password-pepper", {
      label: "password authentication pepper",
      gid: rendererGid,
      mode: 0o440,
      minimumBytes: 32,
      maximumBytes: 16 * 1024,
    });
  }
}

const PLAN_FIELDS = [
  "deploymentMode",
  "authMode",
  "publicOrigin",
  "passwordEnabled",
  "oidcEnabled",
  "bootstrapMethod",
  "followUpOidcRegistration",
  "externalIssuer",
];
export function productionAuthPlanField(contents, field) {
  if (!PLAN_FIELDS.includes(field))
    throw new Error("Unsupported production plan field");
  let plan;
  try {
    plan = JSON.parse(contents);
  } catch {
    throw new Error("Invalid production auth plan JSON");
  }
  if (
    plan === null ||
    typeof plan !== "object" ||
    Array.isArray(plan) ||
    Object.keys(plan).length !== PLAN_FIELDS.length ||
    PLAN_FIELDS.some((key) => !Object.hasOwn(plan, key)) ||
    Object.keys(plan).some((key) => !PLAN_FIELDS.includes(key))
  )
    throw new Error("Invalid production auth plan fields");
  for (const key of PLAN_FIELDS) {
    const value = plan[key];
    if (
      ["passwordEnabled", "oidcEnabled", "followUpOidcRegistration"].includes(
        key,
      )
    ) {
      if (typeof value !== "boolean")
        throw new Error("Invalid production auth plan boolean");
    } else if (
      typeof value !== "string" ||
      value.length > 2048 ||
      [...value].some(
        (c) => c.charCodeAt(0) <= 0x1f || c.charCodeAt(0) === 0x7f,
      )
    )
      throw new Error("Invalid production auth plan text");
  }
  if (
    !["cloudflare", "standalone"].includes(plan.deploymentMode) ||
    !["password", "oidc", "native", "cloudflare-access"].includes(
      plan.authMode,
    ) ||
    (plan.authMode === "cloudflare-access" &&
      plan.deploymentMode !== "cloudflare")
  )
    throw new Error("Invalid production auth plan mode");
  let requirements;
  try {
    requirements = browserAuthenticationRequirements(
      plan.authMode === "cloudflare-access"
        ? { backend: "cloudflare-access" }
        : {
            backend: "native",
            passwordEnabled: plan.passwordEnabled,
            oidcEnabled: plan.oidcEnabled,
          },
    );
  } catch {
    throw new Error("Invalid production auth plan methods");
  }
  const expectedMode =
    plan.authMode === "cloudflare-access"
      ? "cloudflare-access"
      : plan.passwordEnabled && plan.oidcEnabled
        ? "native"
        : requirements.bootstrapMethod;
  if (
    expectedMode !== plan.authMode ||
    Object.entries(requirements).some(([key, value]) => plan[key] !== value)
  )
    throw new Error("Invalid production auth plan requirements");
  try {
    const origin = new URL(plan.publicOrigin);
    if (origin.protocol !== "https:" || origin.origin !== plan.publicOrigin)
      throw new Error();
    if (plan.oidcEnabled || plan.authMode === "cloudflare-access") {
      const issuer = new URL(plan.externalIssuer);
      if (
        issuer.protocol !== "https:" ||
        issuer.username ||
        issuer.password ||
        issuer.search ||
        issuer.hash ||
        /[\s\\]/u.test(plan.externalIssuer)
      )
        throw new Error();
    } else if (plan.externalIssuer !== "") throw new Error();
  } catch {
    throw new Error("Invalid production auth plan origin or issuer");
  }
  return String(plan[field]);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Production profile validation failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 65;
  }
}
