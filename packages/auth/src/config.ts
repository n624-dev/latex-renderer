import type { RendererDatabase } from "@latex-renderer/database";
import {
  browserAuthenticationFromMode,
  legacyBrowserAuthenticationMode,
} from "@latex-renderer/server-setup-core";
import { buildBrowserAuthentication } from "./runtime-builder.js";
import type { BrowserAuthEnvironmentResult } from "./runtime-builder.js";
export type { BrowserAuthEnvironmentResult } from "./runtime-builder.js";

export function createBrowserAuthenticationFromEnvironment(
  database: RendererDatabase,
  audienceVariable = "CLOUDFLARE_ADMIN_AUDIENCE",
  environment: NodeJS.ProcessEnv = process.env,
): BrowserAuthEnvironmentResult {
  // Keep the host rollout gate before all secret reads, provider setup and DB
  // writes. The selection-aware builder is internal, not a new host opt-in.
  const mode = legacyBrowserAuthenticationMode(
    new Map(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  );
  return buildBrowserAuthentication(
    database,
    browserAuthenticationFromMode(mode),
    audienceVariable,
    environment,
  );
}
