import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { ApiKeyService } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { loadSigningKeyRing, TicketService } from "@latex-renderer/ticket";
import { loadResourceLimits } from "@latex-renderer/shared";
import { createInternalApp } from "./app.js";

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) throw new Error(`${name} is required`);
  return value;
}

const database = new RendererDatabase(required("DATABASE_PATH"));
database.migrate();
const pepperId = process.env.API_KEY_PEPPER_ID ?? "v1";
const pepperPath = process.env.CREDENTIALS_DIRECTORY
  ? join(process.env.CREDENTIALS_DIRECTORY, "api-key-pepper")
  : required("API_KEY_PEPPER_FILE");
const pepper = readFileSync(pepperPath);
const signingKid = process.env.TICKET_SIGNING_KID ?? "v1";
const signingKeys=loadSigningKeyRing(signingKid,process.env.TICKET_SIGNING_KEY_DIR,process.env.TICKET_SIGNING_KEY_FILE);
const app = createInternalApp({
  database,
  apiKeys: new ApiKeyService(database, new Map([[pepperId, pepper]]), pepperId),
  tickets: new TicketService(database, "latex-renderer", "latex-render", signingKeys.active, signingKeys.verification),
  rendererPublicUrl: required("RENDERER_PUBLIC_URL"),
  rendererVersion: process.env.RENDERER_IMAGE ?? "latex-renderer:development",
  maxUploadBytes: loadResourceLimits(process.env).maxUploadBytes,
  maxQueueLength: Number(process.env.MAX_QUEUE_LENGTH ?? "100"),
  maxUserStorageBytes: Number(process.env.MAX_USER_STORAGE_BYTES ?? String(1024*1024*1024)),
});

const port = Number(process.env.PORT ?? "3103");
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, (info) => {
  console.log(JSON.stringify({ event: "internal_api.started", address: info.address, port: info.port }));
});
