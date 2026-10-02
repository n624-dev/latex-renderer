import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { RendererDatabase } from "@latex-renderer/database";
import { legacyBrowserAuthenticationMode } from "@latex-renderer/server-setup-core";
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

export function createBrowserAuthenticationFromEnvironment(
  database: RendererDatabase,
  audienceVariable = "CLOUDFLARE_ADMIN_AUDIENCE",
  environment: NodeJS.ProcessEnv = process.env,
): BrowserAuthEnvironmentResult {
  const mode = legacyBrowserAuthenticationMode(
    new Map(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  );
  const deploymentMode = parseDeploymentMode(environment.DEPLOYMENT_MODE);
  const publicOrigin = required(environment, "PUBLIC_ORIGIN");
  if (deploymentMode === "standalone" && mode === "cloudflare-access")
    throw new Error(
      "AUTH_MODE=cloudflare-access requires DEPLOYMENT_MODE=cloudflare",
    );

  if (mode === "cloudflare-access") {
    return prepared({
      deploymentMode,
      publicOrigin,
      browserAuth: new BrowserAuthenticationService({
        database,
        mode,
        publicOrigin,
        access: new AccessJwtVerifier(
          required(environment, "CLOUDFLARE_ACCESS_ISSUER"),
          required(environment, audienceVariable),
        ),
      }),
    });
  }

  if (mode === "oidc") {
    const secret = readSecret(
      environment,
      "oidc-client-secret",
      "OIDC_CLIENT_SECRET_FILE",
    );
    return prepared({
      deploymentMode,
      publicOrigin,
      browserAuth: new BrowserAuthenticationService({
        database,
        mode,
        publicOrigin,
        oidc: new OidcClient({
          issuer: required(environment, "OIDC_ISSUER"),
          clientId: required(environment, "OIDC_CLIENT_ID"),
          clientSecret: secret.toString("utf8").trim(),
          publicOrigin,
          ...(environment.OIDC_ALLOWED_ALGORITHMS
            ? {
                algorithms: environment.OIDC_ALLOWED_ALGORITHMS.split(",").map(
                  (value) => value.trim(),
                ),
              }
            : {}),
        }),
      }),
    });
  }

  return prepared({
    deploymentMode,
    publicOrigin,
    browserAuth: new BrowserAuthenticationService({
      database,
      mode,
      publicOrigin,
      passwordPepper: readSecret(
        environment,
        "auth-password-pepper",
        "AUTH_PASSWORD_PEPPER_FILE",
      ),
    }),
  });
}

function prepared(
  result: BrowserAuthEnvironmentResult,
): BrowserAuthEnvironmentResult {
  // Admin and Remote MCP use this factory before starting their listeners.
  // Complete retirement durably, or fail startup rather than serve a partial
  // policy. Repeated starts with the same policy are a no-op.
  result.browserAuth.retireIncompatibleSessions();
  return result;
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
