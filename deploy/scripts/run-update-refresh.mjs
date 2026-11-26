#!/usr/bin/env node
import { request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { boundedIntegerEnvironment } from "./environment.mjs";
import { isMainModule } from "./is-main-module.mjs";

const reconnectErrors = new Set([
  "ENOENT",
  "ECONNREFUSED",
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
]);

function requestManager(socketPath, token, method, path, signal) {
  return new Promise((resolve, reject) => {
    const body = method === "POST" ? "{}" : undefined;
    const request = httpRequest(
      {
        socketPath,
        path,
        method,
        signal,
        timeout: 30_000,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(body === undefined
            ? {}
            : {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(body),
              }),
        },
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 256 * 1024) {
            response.destroy(new Error("Update Manager response is too large"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          let value;
          try {
            value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            reject(new Error("Update Manager returned invalid JSON"));
            return;
          }
          if ((response.statusCode ?? 500) >= 400) {
            reject(
              new Error(
                value?.error?.message ??
                  `Update Manager returned HTTP ${response.statusCode}`,
              ),
            );
            return;
          }
          resolve(value);
        });
      },
    );
    request.on("timeout", () => {
      request.destroy(
        Object.assign(new Error("Update Manager did not respond"), {
          code: "ETIMEDOUT",
        }),
      );
    });
    request.on("error", reject);
    request.end(body);
  });
}

function report(event, properties) {
  console.log(
    JSON.stringify({ event: `application_update.${event}`, ...properties }),
  );
}

export async function runUpdateRefresh({
  socketPath,
  token,
  maximumWaitMs,
  pollMs,
}) {
  const result = await requestManager(
    socketPath,
    token,
    "POST",
    "/v1/refresh",
    AbortSignal.timeout(60_000),
  );
  const status = result?.status;
  if (["available", "unavailable", "up-to-date"].includes(status)) {
    report("refresh", { status });
    return;
  }
  if (status !== "started")
    throw new Error("Update Manager returned an invalid refresh status");

  const id = result.operation?.id;
  if (typeof id !== "string" || !/^updop_[A-Za-z0-9_-]+$/.test(id))
    throw new Error("Update Manager did not return an operation ID");
  report("started", { operationId: id });

  const signal = AbortSignal.timeout(maximumWaitMs);
  let reconnecting = false;
  for (;;) {
    let operation;
    try {
      await delay(pollMs, undefined, { signal });
      operation = await requestManager(
        socketPath,
        token,
        "GET",
        `/v1/operations/${id}?includeLog=0`,
        signal,
      );
    } catch (error) {
      if (signal.aborted)
        throw new Error(
          `Automatic application update ${id} timed out after ${maximumWaitMs} ms`,
          { cause: error },
        );
      if (!reconnectErrors.has(error?.code)) throw error;
      if (!reconnecting) report("reconnecting", { operationId: id });
      reconnecting = true;
      continue;
    }
    reconnecting = false;

    if (
      operation?.id !== id ||
      !["running", "failed", "succeeded"].includes(operation.status)
    )
      throw new Error(
        `Update Manager did not return the state of update ${id}`,
      );
    if (operation.status === "failed")
      throw new Error(`Automatic application update ${id} failed`);
    if (
      operation.status === "succeeded" &&
      operation.outcome?.complete === true
    ) {
      report("completed", { operationId: id });
      return;
    }
    const finished = Date.parse(operation.finishedAt ?? "");
    if (Number.isFinite(finished) && Date.now() - finished >= 10 * 60_000)
      throw new Error(
        `Automatic application update ${id} did not activate the expected Updater`,
      );
  }
}

if (isMainModule(import.meta.url)) {
  const socketPath =
    process.env.UPDATE_MANAGER_SOCKET ??
    "/run/latex-renderer/update-manager.sock";
  const tokenFile =
    process.env.UPDATE_MANAGER_TOKEN_FILE ??
    "/etc/latex-renderer/secrets/update-manager-token";
  if (
    !socketPath.startsWith("/run/latex-renderer/") ||
    !socketPath.endsWith(".sock")
  )
    throw new Error("UPDATE_MANAGER_SOCKET must be below /run/latex-renderer");
  const token = (await readFile(tokenFile, "utf8")).trim();
  if (token.length < 32) throw new Error("Update Manager token is too short");
  const maximumWaitMs = boundedIntegerEnvironment(
    process.env,
    "UPDATE_REFRESH_MAX_WAIT_MS",
    4.5 * 60 * 60 * 1000,
    60_000,
    12 * 60 * 60 * 1000,
  );
  const pollMs = boundedIntegerEnvironment(
    process.env,
    "UPDATE_REFRESH_POLL_MS",
    5_000,
    1_000,
    60_000,
  );
  await runUpdateRefresh({ socketPath, token, maximumWaitMs, pollMs });
}
