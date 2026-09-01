#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";
import { boundedIntegerEnvironment } from "./environment.mjs";

if (process.getuid?.() !== 0) {
  console.error("reconcile-managed-runtime.mjs must run as root");
  process.exit(77);
}

const endpoint = new URL(process.env.IMAGE_MANAGER_URL ?? "http://127.0.0.1:3110");
if (
  endpoint.protocol !== "http:" ||
  !["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname) ||
  endpoint.username !== "" ||
  endpoint.password !== ""
) {
  throw new Error("IMAGE_MANAGER_URL must be an unauthenticated loopback HTTP URL");
}

const tokenFile =
  process.env.IMAGE_MANAGER_TOKEN_FILE ??
  "/etc/latex-renderer/secrets/image-manager-token";
const token = (await readFile(tokenFile, "utf8")).trim();
if (token.length < 32) throw new Error("Image manager token is too short");

const timeoutMs = boundedIntegerEnvironment(
  process.env,
  "IMAGE_RECONCILE_TIMEOUT_MS",
  21_600_000,
  1_000,
  21_600_000,
);

async function request(path, init = {}) {
  const response = await globalThis.fetch(new URL(path, endpoint), {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    signal: globalThis.AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      value?.error?.message ?? `Image Manager returned HTTP ${response.status}`,
    );
  }
  return value;
}

const operation = await request("/v1/reconcile", {
  method: "POST",
  body: "{}",
});
if (!/^imgop_[A-Za-z0-9_-]+$/.test(operation?.id ?? "")) {
  throw new Error("Image Manager returned an invalid operation id");
}

const deadline = Date.now() + timeoutMs;
while (Date.now() < deadline) {
  const current = await request(`/v1/operations/${operation.id}`);
  if (current.status === "succeeded") {
    console.log(`TeX Runtime reconciled from saved settings: ${operation.id}`);
    process.exit(0);
  }
  if (current.status === "failed") {
    if (typeof current.log === "string" && current.log.trim()) {
      console.error(current.log.trimEnd());
    }
    throw new Error(current.error ?? "TeX Runtime reconciliation failed");
  }
  await delay(2_000);
}

throw new Error(`TeX Runtime reconciliation timed out after ${timeoutMs}ms`);
