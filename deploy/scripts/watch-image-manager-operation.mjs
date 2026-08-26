#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const baseUrl = process.env.IMAGE_MANAGER_URL ?? "http://127.0.0.1:3110";
const credentialsDirectory = process.env.CREDENTIALS_DIRECTORY;
const tokenFile = process.env.IMAGE_MANAGER_TOKEN_FILE ??
  (credentialsDirectory ? join(credentialsDirectory, "image-manager-token") : null);
const maxAgeMs = Number(process.env.IMAGE_OPERATION_MAX_AGE_MS ?? String(4 * 60 * 60 * 1000));
const rendererConsumers = [
  "latex-renderer-worker.service",
  "latex-renderer-internal-api.service",
  "latex-renderer-remote-mcp.service",
];

const endpoint = new globalThis.URL(baseUrl);
if (
  endpoint.protocol !== "http:" ||
  !["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname) ||
  endpoint.username !== "" ||
  endpoint.password !== ""
) throw new Error("IMAGE_MANAGER_URL must be an unauthenticated loopback HTTP URL");
if (!tokenFile) throw new Error("Image manager credential path is unavailable");
if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 10 * 60_000 || maxAgeMs > 12 * 60 * 60_000)
  throw new Error("IMAGE_OPERATION_MAX_AGE_MS must be between 10 minutes and 12 hours");

const token = (await readFile(tokenFile, "utf8")).trim();
if (token.length < 32) throw new Error("Image manager token is too short");

async function request(path) {
  const response = await globalThis.fetch(new globalThis.URL(path, endpoint), {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value?.error?.message ?? `Image manager returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return value;
}

function systemctl(args, options = {}) {
  return spawnSync("systemctl", args, { stdio: options.stdio ?? "ignore" });
}
function sleep(ms) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
async function waitForManagerState() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      return await request("/v1/state");
    } catch (error) {
      lastError = error;
      await sleep(1_000);
    }
  }
  throw new Error(`Image Manager did not become API-ready after restart: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

const state = await request("/v1/state");
const operationId = typeof state?.activeOperationId === "string" ? state.activeOperationId : null;
if (!operationId) process.exit(0);

const operation = await request(`/v1/operations/${encodeURIComponent(operationId)}`);
if (operation?.status !== "running") process.exit(0);
const startedAt = typeof operation.startedAt === "string" ? Date.parse(operation.startedAt) : Number.NaN;
if (!Number.isFinite(startedAt)) throw new Error(`Active image operation ${operationId} has an invalid startedAt timestamp`);
const ageMs = Date.now() - startedAt;
if (ageMs <= maxAgeMs) {
  console.log(JSON.stringify({ event: "image_operation_watchdog.ok", operationId, ageMs, maxAgeMs }));
  process.exit(0);
}

const previouslyActiveConsumers = rendererConsumers.filter(
  (unit) => systemctl(["is-active", "--quiet", unit]).status === 0,
);
console.error(JSON.stringify({
  event: "image_operation_watchdog.stale",
  operationId,
  ageMs,
  maxAgeMs,
  action: "restart-image-manager",
  previouslyActiveConsumers,
}));
const restart = systemctl(["restart", "latex-renderer-image-manager.service"], { stdio: "inherit" });
if (restart.status !== 0) throw new Error("Could not restart Image Manager after a stale operation");

const recovered = await waitForManagerState();
if (recovered?.activeOperationId) {
  throw new Error(`Image Manager restarted but operation lock is still active: ${recovered.activeOperationId}`);
}
for (const unit of previouslyActiveConsumers) {
  const start = systemctl(["start", unit], { stdio: "inherit" });
  if (start.status !== 0) throw new Error(`Could not restore renderer consumer after watchdog recovery: ${unit}`);
}
