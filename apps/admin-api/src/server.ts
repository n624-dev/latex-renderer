import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { AccessJwtVerifier, ApiKeyService } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { loadSigningKeyRing, TicketService } from "@latex-renderer/ticket";
import { loadResourceLimits } from "@latex-renderer/shared";
import { createAdminApp } from "./app.js";
import { ImageManagerClient } from "./services/image-manager.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
if (process.env.ADMIN_API_ENABLED === "false")
  throw new Error("Admin API is disabled by configuration");
const database = new RendererDatabase(required("DATABASE_PATH"));
database.migrate();
const pepperId = process.env.API_KEY_PEPPER_ID ?? "v1";
const pepperPath = process.env.CREDENTIALS_DIRECTORY
  ? join(process.env.CREDENTIALS_DIRECTORY, "api-key-pepper")
  : required("API_KEY_PEPPER_FILE");
const activeTicketKid = process.env.TICKET_SIGNING_KID ?? "v1";
const signingKeys = loadSigningKeyRing(
  activeTicketKid,
  process.env.TICKET_SIGNING_KEY_DIR,
  process.env.TICKET_SIGNING_KEY_FILE,
);
const verificationTicketKids = signingKeys.verification
  .map((key) => key.kid)
  .sort();
const imageManagerUrl = process.env.IMAGE_MANAGER_URL;
const imageManagerTokenPath = imageManagerUrl
  ? process.env.CREDENTIALS_DIRECTORY
    ? join(process.env.CREDENTIALS_DIRECTORY, "image-manager-token")
    : required("IMAGE_MANAGER_TOKEN_FILE")
  : undefined;
const imageManager =
  imageManagerUrl && imageManagerTokenPath
    ? new ImageManagerClient(
        imageManagerUrl,
        readFileSync(imageManagerTokenPath, "utf8").trim(),
      )
    : undefined;
const app = createAdminApp({
  database,
  apiKeys: new ApiKeyService(
    database,
    new Map([[pepperId, readFileSync(pepperPath)]]),
    pepperId,
  ),
  access: new AccessJwtVerifier(
    required("CLOUDFLARE_ACCESS_ISSUER"),
    required("CLOUDFLARE_ADMIN_AUDIENCE"),
  ),
  allowedOrigins: new Set(required("ADMIN_ALLOWED_ORIGINS").split(",")),
  writeEnabled: process.env.ADMIN_API_WRITE_ENABLED !== "false",
  storageRoot: required("STORAGE_ROOT"),
  rendererVersion: required("RENDERER_IMAGE"),
  ...(imageManager ? { imageManager } : {}),
  maxUploadBytes: loadResourceLimits(process.env).maxUploadBytes,
  maxQueueLength: Number(process.env.MAX_QUEUE_LENGTH ?? "100"),
  maxUserStorageBytes: Number(
    process.env.MAX_USER_STORAGE_BYTES ?? String(1024 * 1024 * 1024),
  ),
  minFreeStorageBytes: Number(
    process.env.MIN_FREE_STORAGE_BYTES ?? String(5 * 1024 * 1024 * 1024),
  ),
  artifactRetentionHours: Number(process.env.ARTIFACT_RETENTION_HOURS ?? "24"),
  environmentRoot:
    process.env.RENDERER_ENVIRONMENT_ROOT ??
    "/var/lib/latex-renderer/environment",
  activeTicketKid,
  verificationTicketKids,
  renderTickets: {
    tickets: new TicketService(
      database,
      "latex-renderer",
      "latex-render",
      signingKeys.active,
      signingKeys.verification,
    ),
    rendererPublicUrl:
      process.env.RENDERER_PUBLIC_URL ?? "https://latex-render.n624.jp",
  },
});
serve(
  {
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port: Number(process.env.PORT ?? "3102"),
  },
  (info) => {
    console.log(
      JSON.stringify({
        event: "admin_api.started",
        address: info.address,
        port: info.port,
      }),
    );
  },
);
