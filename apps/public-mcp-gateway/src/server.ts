import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { PLATFORM_VERSION } from "@latex-renderer/shared";
import { z } from "zod";
import { createGateway } from "./gateway.js";
import { HttpsCredentialKeys } from "./https-credential-keys.js";
import { SqliteConnectionStore } from "./sqlite-connections.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integer(name: string, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value < 1 || value > max)
    throw new Error(`${name} must be a valid integer`);
  return value;
}

function key(name: string): Buffer {
  const value = readFileSync(required(name), "utf8").trim();
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value)
    throw new Error(`${name} must contain a 32-byte key`);
  return bytes;
}

const approvedClients = z
  .object({
    dcr: z.array(z.url()).min(1),
    cimd: z
      .array(
        z
          .object({
            id: z.url(),
            jwksUri: z.url(),
            redirectUris: z.array(z.url()).min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
const clients = approvedClients.parse(
  JSON.parse(readFileSync(required("GATEWAY_CLIENTS_FILE"), "utf8")) as unknown,
);
const origin = required("GATEWAY_PUBLIC_ORIGIN"),
  port = integer("GATEWAY_PORT", 65535);
const store = new SqliteConnectionStore(required("GATEWAY_DATABASE"));
const limits = {
  pending: integer("GATEWAY_MAX_PENDING"),
  maxBodyBytes: integer("GATEWAY_MAX_BODY_BYTES"),
  maxSourceBytes: integer("GATEWAY_MAX_SOURCE_BYTES"),
  maxResponseBytes: integer("GATEWAY_MAX_RESPONSE_BYTES"),
  maxDownloadBytes: integer("GATEWAY_MAX_DOWNLOAD_BYTES"),
  maxSockets: integer("GATEWAY_MAX_AGENT_SOCKETS"),
  concurrency: integer("GATEWAY_MAX_OPERATIONS"),
  registrations: integer("GATEWAY_MAX_REGISTRATIONS"),
  timeoutMs: integer("GATEWAY_TIMEOUT_MS", 2_147_483_647),
  attempts: {
    perTransport: integer("GATEWAY_PAIR_ATTEMPTS_PER_TRANSPORT"),
    perInstance: integer("GATEWAY_PAIR_ATTEMPTS_PER_INSTANCE"),
    total: integer("GATEWAY_PAIR_ATTEMPTS_TOTAL"),
  },
};
const routes = new Map<string, number>();
const registrationRate = integer("GATEWAY_REGISTRATIONS_PER_IP_MINUTE");
let window = 0;
const gateway = createGateway({
  store,
  origin,
  version: PLATFORM_VERSION,
  limits,
  secrets: {
    refresh: key("GATEWAY_REFRESH_KEY_FILE"),
    pairing: key("GATEWAY_PAIRING_KEY_FILE"),
    references: key("GATEWAY_REFERENCE_KEY_FILE"),
    https: new HttpsCredentialKeys(
      "current",
      new Map([["current", key("GATEWAY_HTTPS_KEY_FILE")]]),
    ),
  },
  dcrRedirectUris: new Set(clients.dcr),
  cimdClients: new Map(
    clients.cimd.map((client) => [
      client.id,
      { jwksUri: client.jwksUri, redirectUris: new Set(client.redirectUris) },
    ]),
  ),
  allowRegistration(request) {
    const peer = request.headers.get("X-Real-IP");
    if (!peer || !isIP(peer)) return false;
    const minute = Math.floor(Date.now() / 60_000);
    if (window !== minute) {
      routes.clear();
      window = minute;
    }
    if (!routes.has(peer) && routes.size >= limits.pending) return false;
    const used = routes.get(peer) ?? 0;
    if (used >= registrationRate) return false;
    routes.set(peer, used + 1);
    return true;
  },
});

store.pruneExpiredCredentials(Date.now());
const cleanup = setInterval(() => {
  try {
    store.pruneExpiredCredentials(Date.now());
  } catch {
    console.error("Expired MCP gateway credentials could not be removed.");
  }
}, 3600_000).unref();
gateway.server.listen(port, "127.0.0.1");
for (const event of ["SIGTERM", "SIGINT"] as const)
  process.once(event, () => {
    clearInterval(cleanup);
    gateway.closeConnections();
    gateway.server.close(() => store.close());
  });
