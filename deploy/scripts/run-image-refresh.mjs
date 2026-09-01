#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { boundedIntegerEnvironment } from "./environment.mjs";

const baseUrl = process.env.IMAGE_MANAGER_URL ?? "http://127.0.0.1:3110";
const credentialsDirectory = process.env.CREDENTIALS_DIRECTORY;
const tokenFile = process.env.IMAGE_MANAGER_TOKEN_FILE ??
  (credentialsDirectory ? join(credentialsDirectory, "image-manager-token") : null);
// The watchdog declares operations stale after four hours. Wait beyond that
// boundary so a watchdog restart can settle the operation to failed/succeeded
// instead of reporting a timeout while the mutation is still running.
const maxWaitMs = boundedIntegerEnvironment(process.env, "IMAGE_REFRESH_MAX_WAIT_MS", 4.5 * 60 * 60 * 1000, 60_000, 12 * 60 * 60 * 1000);
const pollMs = boundedIntegerEnvironment(process.env, "IMAGE_REFRESH_POLL_MS", 5_000, 1_000, 60_000);

const endpoint = new globalThis.URL(baseUrl);
if (
  endpoint.protocol !== "http:" ||
  !["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname) ||
  endpoint.username !== "" ||
  endpoint.password !== ""
) throw new Error("IMAGE_MANAGER_URL must be an unauthenticated loopback HTTP URL");
if (!tokenFile) throw new Error("Image manager credential path is unavailable");

const token = (await readFile(tokenFile, "utf8")).trim();
if (token.length < 32) throw new Error("Image manager token is too short");

async function request(method, path, body) {
  const response = await globalThis.fetch(new globalThis.URL(path, endpoint), {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message = value?.error?.message ?? `Image manager returned HTTP ${response.status}`;
    throw new Error(message);
  }
  return value;
}

function normalizedLanguages(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").sort()
    : [];
}

const state = await request("GET", "/v1/state");
const desired = state?.desired ?? {};
const current = state?.current ?? null;
let operation;

if (desired.autoUpdate === true && desired.selector?.mode === "latest") {
  const desiredLanguages = normalizedLanguages(desired.languages);
  const currentLanguages = normalizedLanguages(current?.languages);
  const runtimeDrift =
    current?.selector?.mode !== "latest" ||
    desiredLanguages.length !== currentLanguages.length ||
    desiredLanguages.some((language, index) => language !== currentLanguages[index]);

  operation = runtimeDrift
    ? await request("POST", "/v1/apply", {
        selector: { mode: "latest", value: null },
        languages: desiredLanguages,
        autoUpdate: true,
        rebuildIfMissing: false,
      })
    : await request("POST", "/v1/refresh", {});
} else {
  operation = await request("POST", "/v1/refresh", {});
}

if (!operation || typeof operation.id !== "string")
  throw new Error("Image manager did not return a refresh operation id");

const deadline = Date.now() + maxWaitMs;
let lastStatus = "";
let requestFailures = 0;
while (Date.now() < deadline) {
  let currentOperation;
  try {
    currentOperation = await request("GET", `/v1/operations/${encodeURIComponent(operation.id)}`);
    requestFailures = 0;
  } catch (error) {
    requestFailures += 1;
    if (requestFailures === 1 || requestFailures % 12 === 0) {
      console.warn(JSON.stringify({
        event: "image_refresh.reconnecting",
        operationId: operation.id,
        failures: requestFailures,
        message: error instanceof Error ? error.message : String(error),
      }));
    }
    await new Promise((resolve) => globalThis.setTimeout(resolve, pollMs));
    continue;
  }
  const status = typeof currentOperation?.status === "string" ? currentOperation.status : "unknown";
  if (status !== lastStatus) {
    console.log(JSON.stringify({ event: "image_refresh.status", operationId: operation.id, status }));
    lastStatus = status;
  }
  if (status === "succeeded") process.exit(0);
  if (status === "failed") throw new Error(currentOperation?.error ?? "Automatic TeX image refresh failed");
  await new Promise((resolve) => globalThis.setTimeout(resolve, pollMs));
}
throw new Error(`Automatic TeX image refresh timed out after ${maxWaitMs} ms`);
