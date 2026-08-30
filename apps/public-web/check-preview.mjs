#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const host = "127.0.0.1";
const port = await availablePort();
const baseUrl = `http://${host}:${port}`;
let output = "";

const worker = spawn(
  "wrangler",
  ["dev", "--local", "--ip", host, "--port", String(port)],
  {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
worker.stdout.setEncoding("utf8");
worker.stderr.setEncoding("utf8");
for (const stream of [worker.stdout, worker.stderr]) {
  stream.on("data", (chunk) => {
    output = `${output}${chunk}`.slice(-12_000);
  });
}
const exited = new Promise((resolve) => worker.once("exit", resolve));

try {
  await waitUntilReady();
  await assertAsset("/", 200, "text/html", "LaTeXをPDFに変換");
  await assertAsset("/docs/", 200, "text/html", "最短でPDFを作る");
  await assertAsset("/downloads/", 200, "text/html", "最新版ZIP");
  await assertAsset(
    "/assets/login.js",
    200,
    "text/javascript",
    "/auth/config",
  );
  await assertAsset("/assets/styles.css", 200, "text/css");
  await assertAsset(
    "/assets/docs-search.json",
    200,
    "application/json",
    '"title":"はじめに"',
  );
  await assertAsset("/openapi/gateway.openapi.yaml", 200, "application/yaml");
  await assertAsset("/definitely-not-present", 404, "text/html");

  const redirect = await globalThis.fetch(`${baseUrl}/client/install.ps1`, {
    redirect: "manual",
  });
  if (
    redirect.status !== 308 ||
    redirect.headers.get("location") !== "/downloads/windows/install.ps1"
  ) {
    throw new Error(`Preview redirect contract failed (${redirect.status})`);
  }
  assertWorkerMarker(redirect, "/client/install.ps1");
  globalThis.console.log(
    `Local Workers Static Assets preview passed at ${baseUrl}.`,
  );
} finally {
  worker.kill("SIGTERM");
  if ((await Promise.race([exited, delay(5_000, "timeout")])) === "timeout") {
    worker.kill("SIGKILL");
    await exited;
  }
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    server.close();
    throw new Error("Could not allocate a local preview port");
  }
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return address.port;
}

async function waitUntilReady() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (worker.exitCode !== null) {
      throw new Error(`Wrangler preview exited early:\n${output}`);
    }
    try {
      const response = await globalThis.fetch(`${baseUrl}/`, {
        redirect: "manual",
      });
      if (response.status === 200) return;
    } catch {
      // Wrangler is still starting.
    }
    await delay(250);
  }
  throw new Error(`Wrangler preview did not become ready:\n${output}`);
}

async function assertAsset(path, status, contentType, expectedText) {
  const response = await globalThis.fetch(`${baseUrl}${path}`, {
    redirect: "manual",
  });
  if (response.status !== status) {
    throw new Error(
      `Preview ${path} returned ${response.status}, expected ${status}`,
    );
  }
  assertWorkerMarker(response, path);
  if (!response.headers.get("content-type")?.startsWith(contentType)) {
    throw new Error(`Preview ${path} has an unexpected Content-Type`);
  }
  if (
    expectedText !== undefined &&
    !(await response.text()).includes(expectedText)
  ) {
    throw new Error(`Preview ${path} is missing expected content`);
  }
}

function assertWorkerMarker(response, path) {
  if (response.headers.get("x-latex-renderer-serving") !== "workers-static") {
    throw new Error(`Preview Worker marker missing for ${path}`);
  }
}
