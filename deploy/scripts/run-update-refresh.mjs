#!/usr/bin/env node
import { request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";

const socketPath = process.env.UPDATE_MANAGER_SOCKET ?? "/run/latex-renderer/update-manager.sock";
const tokenFile = process.env.UPDATE_MANAGER_TOKEN_FILE ?? "/etc/latex-renderer/secrets/update-manager-token";
if (!socketPath.startsWith("/run/latex-renderer/") || !socketPath.endsWith(".sock")) {
  throw new Error("UPDATE_MANAGER_SOCKET must be below /run/latex-renderer");
}
const token = (await readFile(tokenFile, "utf8")).trim();
if (token.length < 32) throw new Error("Update Manager token is too short");

const result = await new Promise((resolve, reject) => {
  const body = "{}";
  const request = httpRequest({
    socketPath,
    path: "/v1/refresh",
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: 60_000,
  }, (response) => {
    const chunks = [];
    let size = 0;
    response.on("data", (chunk) => {
      size += chunk.length;
      if (size > 256 * 1024) response.destroy(new Error("Update Manager response is too large"));
      else chunks.push(chunk);
    });
    response.on("error", reject);
    response.on("end", () => {
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
      catch { return reject(new Error("Update Manager returned invalid JSON")); }
      if ((response.statusCode ?? 500) >= 400) return reject(new Error(value?.error?.message ?? `Update Manager returned HTTP ${response.statusCode}`));
      resolve(value);
    });
  });
  request.on("timeout", () => request.destroy(new Error("Update Manager refresh timed out")));
  request.on("error", reject);
  request.end(body);
});
console.log(JSON.stringify({ event: "application_update.refresh", result }));
