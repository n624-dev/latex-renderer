import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RendererDatabase } from "@latex-renderer/database";
import {
  browserAuthenticationRequirements,
  validateBrowserAuthenticationSelection,
  type BrowserAuthenticationSelection,
} from "@latex-renderer/server-setup-core";
import {
  BrowserAuthenticationService,
  parseDeploymentMode,
  type DeploymentMode,
} from "./browser.js";
import { AccessJwtVerifier } from "./access.js";
import { OidcClient } from "./oidc.js";

export interface BrowserAuthEnvironmentResult {
  browserAuth: BrowserAuthenticationService;
  deploymentMode: DeploymentMode;
  publicOrigin: string;
}

// Internal construction boundary, not exported by index.ts. Both services use
// the public environment factory and the same validated method selection.
export function buildBrowserAuthentication(
  database: RendererDatabase,
  input: BrowserAuthenticationSelection,
  audienceVariable: string,
  environment: NodeJS.ProcessEnv,
): BrowserAuthEnvironmentResult {
  const selection = validateBrowserAuthenticationSelection(input);
  const requirements = browserAuthenticationRequirements(selection);
  const deploymentMode = parseDeploymentMode(environment.DEPLOYMENT_MODE);
  const publicOrigin = required(environment, "PUBLIC_ORIGIN");
  if (
    deploymentMode === "standalone" &&
    selection.backend === "cloudflare-access"
  )
    throw new Error(
      "AUTH_MODE=cloudflare-access requires DEPLOYMENT_MODE=cloudflare",
    );
  // Both enabled native methods require their own credential. Never construct
  // a partial service, retire sessions, or fall back to another method on error.
  const passwordPepper = requirements.passwordEnabled
    ? readSecret(
        environment,
        "auth-password-pepper",
        "AUTH_PASSWORD_PEPPER_FILE",
      )
    : undefined;
  const oidc = requirements.oidcEnabled
    ? new OidcClient({
        issuer: required(environment, "OIDC_ISSUER"),
        clientId: required(environment, "OIDC_CLIENT_ID"),
        clientSecret: readSecret(
          environment,
          "oidc-client-secret",
          "OIDC_CLIENT_SECRET_FILE",
        )
          .toString("utf8")
          .trim(),
        publicOrigin,
        ...(environment.OIDC_ALLOWED_ALGORITHMS
          ? {
              algorithms: environment.OIDC_ALLOWED_ALGORITHMS.split(",").map(
                (value) => value.trim(),
              ),
            }
          : {}),
      })
    : undefined;
  const browserAuth = new BrowserAuthenticationService({
    database,
    selection,
    publicOrigin,
    passwordPepper,
    oidc,
    ...(selection.backend === "cloudflare-access"
      ? {
          access: new AccessJwtVerifier(
            required(environment, "CLOUDFLARE_ACCESS_ISSUER"),
            required(environment, audienceVariable),
          ),
        }
      : {}),
  });
  // Shared by Admin and Remote MCP before their listeners start. Any durable
  // retirement/audit failure aborts startup. CLI hashing constructors bypass it.
  browserAuth.retireIncompatibleSessions();
  return { deploymentMode, publicOrigin, browserAuth };
}

function readSecret(
  environment: NodeJS.ProcessEnv,
  credentialName: string,
  fileVariable: string,
): Buffer {
  const path = environment[fileVariable]
    ? required(environment, fileVariable)
    : environment.CREDENTIALS_DIRECTORY
      ? join(environment.CREDENTIALS_DIRECTORY, credentialName)
      : required(environment, fileVariable);
  const value = readFileSync(path);
  if (value.length < 16 || value.length > 16 * 1024)
    throw new Error(`${fileVariable} has an invalid size`);
  return value;
}
function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
}
