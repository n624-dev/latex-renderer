import { existsSync } from "node:fs";
import { URL } from "node:url";

// Client-only builds do not require the server workspaces. Server assemblies
// build Web first and must include these same public assets used by Workers.
if (
  existsSync(
    new URL("../../apps/admin-web/dist/static-site.js", import.meta.url),
  )
)
  await import("../../apps/public-web/build.mjs");
