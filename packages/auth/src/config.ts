import type { RendererDatabase } from "@latex-renderer/database";
import { parseBrowserAuthenticationSelection } from "@latex-renderer/server-setup-core";
import { buildBrowserAuthentication } from "./runtime-builder.js";
import type { BrowserAuthEnvironmentResult } from "./runtime-builder.js";
export type { BrowserAuthEnvironmentResult } from "./runtime-builder.js";

export function createBrowserAuthenticationFromEnvironment(
  database: RendererDatabase,
  audienceVariable = "CLOUDFLARE_ADMIN_AUDIENCE",
  environment: NodeJS.ProcessEnv = process.env,
): BrowserAuthEnvironmentResult {
  // Validate the entire selection before secret reads and durable retirement.
  // Legacy AUTH_MODE retains exactly its old single-method behavior.
  const selection = parseBrowserAuthenticationSelection(
    new Map(
      Object.entries(environment).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
  );
  return buildBrowserAuthentication(
    database,
    selection,
    audienceVariable,
    environment,
  );
}
