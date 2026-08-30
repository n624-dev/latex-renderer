#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function hostnameFromOrigin(origin) {
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "PUBLIC_ORIGIN must be an HTTPS origin without a path, query, or fragment",
    );
  return url.hostname;
}

export function desiredLatexRoutes(hostname) {
  return [
    {
      hostname,
      path: "^/\\.well-known/oauth-(authorization-server|protected-resource)(/.*)?$",
      service: "http://127.0.0.1:3104",
    },
    {
      hostname,
      path: "^/(oauth|mcp)(/.*)?$",
      service: "http://127.0.0.1:3104",
    },
    {
      hostname,
      path: "^/auth(/.*)?$",
      service: "http://127.0.0.1:3102",
    },
    {
      hostname,
      path: "^/admin/api(/.*)?$",
      service: "http://127.0.0.1:3102",
    },
    {
      hostname,
      path: "^/admin(/.*)?$",
      service: "http://127.0.0.1:3101",
    },
    {
      hostname,
      path: "^/app/api(/.*)?$",
      service: "http://127.0.0.1:3102",
    },
    {
      hostname,
      path: "^/app(/.*)?$",
      service: "http://127.0.0.1:3101",
    },
    {
      hostname,
      path: "^/api(/.*)?$",
      service: "http://127.0.0.1:3100",
    },
    { hostname, service: "http://127.0.0.1:3101" },
  ];
}

export function reconcileLatexRoutes(
  ingress,
  { hostname, legacyHostnames = [] },
) {
  if (!Array.isArray(ingress))
    throw new Error("Tunnel configuration has no ingress array");
  if (!ingress.some((rule) => rule?.hostname === hostname))
    throw new Error(`Tunnel configuration has no ${hostname} route`);

  const desired = desiredLatexRoutes(hostname);
  const legacy = new Set(legacyHostnames);
  const reconciled = [];
  let inserted = false;
  for (const rule of ingress) {
    if (rule?.hostname === hostname) {
      if (!inserted) reconciled.push(...desired);
      inserted = true;
      continue;
    }
    if (legacy.has(rule?.hostname)) continue;
    reconciled.push(rule);
  }
  return reconciled;
}

function sameLatexRoutes(ingress, options) {
  if (!Array.isArray(ingress)) return false;
  const legacy = new Set(options.legacyHostnames);
  if (ingress.some((rule) => legacy.has(rule?.hostname))) return false;
  const actual = ingress
    .filter((rule) => rule?.hostname === options.hostname)
    .map(({ hostname, path, service }) => ({
      hostname,
      ...(path === undefined ? {} : { path }),
      service,
    }));
  return (
    JSON.stringify(actual) ===
    JSON.stringify(desiredLatexRoutes(options.hostname))
  );
}

async function apiRequest(configurationUrl, token, method = "GET", body) {
  const response = await globalThis.fetch(configurationUrl, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok || payload.success !== true) {
    throw new Error(
      `Cloudflare Tunnel API failed (${response.status}): ${JSON.stringify(payload.errors ?? [])}`,
    );
  }
  return payload.result;
}

function authenticationToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    const output = execFileSync(
      "pnpm",
      ["exec", "wrangler", "auth", "token", "--json"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const credentials = JSON.parse(output);
    if (typeof credentials.token === "string" && credentials.token.length > 0)
      return credentials.token;
  } catch {
    // The actionable, secret-free error below covers missing and expired credentials.
  }
  throw new Error(
    "Cloudflare credentials unavailable; run `pnpm exec wrangler login` or set CLOUDFLARE_API_TOKEN",
  );
}

async function main() {
  const apply = process.argv.includes("--apply");
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  const tunnelId = requiredEnvironment("CLOUDFLARE_TUNNEL_ID");
  if (!/^[0-9a-f-]{36}$/i.test(tunnelId))
    throw new Error("CLOUDFLARE_TUNNEL_ID must be a UUID");
  const hostname = hostnameFromOrigin(requiredEnvironment("PUBLIC_ORIGIN"));
  const legacyHostnames = (process.env.CLOUDFLARE_LEGACY_HOSTNAMES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const options = { hostname, legacyHostnames };
  const configurationUrl =
    `https://api.cloudflare.com/client/v4/accounts/${accountId}` +
    `/cfd_tunnel/${tunnelId}/configurations`;
  const token = authenticationToken();
  const before = await apiRequest(configurationUrl, token);
  if (before.source !== "cloudflare")
    throw new Error(
      `Tunnel is not remotely managed (source: ${before.source})`,
    );
  const ingress = before.config?.ingress;
  if (sameLatexRoutes(ingress, options)) {
    console.log(
      `Remote Cloudflare Tunnel routes already match (version ${before.version}).`,
    );
    return;
  }
  const nextIngress = reconcileLatexRoutes(ingress, options);
  if (!apply) {
    console.error(
      "Remote Cloudflare Tunnel routes differ; rerun with --apply.",
    );
    process.exitCode = 2;
    return;
  }
  const updated = await apiRequest(configurationUrl, token, "PUT", {
    config: { ...before.config, ingress: nextIngress },
  });
  const readback = await apiRequest(configurationUrl, token);
  if (
    !sameLatexRoutes(readback.config?.ingress, options) ||
    readback.version !== updated.version
  ) {
    throw new Error(
      "Cloudflare Tunnel configuration read-back verification failed",
    );
  }
  console.log(
    `Remote Cloudflare Tunnel routes updated and verified (version ${before.version} -> ${readback.version}).`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
