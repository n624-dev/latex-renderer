#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, URL, URLSearchParams } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const apiBase = "https://api.cloudflare.com/client/v4";

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

export function desiredPublicWorkerPatterns(hostname) {
  return [
    `${hostname}/`,
    `${hostname}/docs`,
    `${hostname}/docs/*`,
    `${hostname}/downloads`,
    `${hostname}/downloads/*`,
    `${hostname}/assets/*`,
    `${hostname}/openapi/*`,
    `${hostname}/client`,
    `${hostname}/client/*`,
  ];
}

export function planPublicWorkerRoutes(
  routes,
  { patterns, script, enabled = true },
) {
  if (!Array.isArray(routes))
    throw new Error("Cloudflare returned no Worker Routes array");

  const desired = new Set(enabled ? patterns : []);
  const byPattern = new Map(routes.map((route) => [route.pattern, route]));
  const conflicts = patterns
    .map((pattern) => byPattern.get(pattern))
    .filter((route) => route !== undefined && route.script !== script);
  if (enabled && conflicts.length > 0) {
    throw new Error(
      `Refusing to replace Worker Routes owned by another script: ${conflicts
        .map((route) => `${route.pattern} -> ${route.script ?? "<no script>"}`)
        .join(", ")}`,
    );
  }

  const create = enabled
    ? patterns.filter((pattern) => !byPattern.has(pattern))
    : [];
  const remove = routes.filter(
    (route) => route.script === script && !desired.has(route.pattern),
  );
  return { create, remove };
}

function routesMatch(routes, options) {
  const { create, remove } = planPublicWorkerRoutes(routes, options);
  return create.length === 0 && remove.length === 0;
}

async function apiRequest(token, path, method = "GET", body) {
  const response = await globalThis.fetch(`${apiBase}${path}`, {
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
      `Cloudflare API failed (${response.status}): ${JSON.stringify(payload.errors ?? [])}`,
    );
  }
  return payload.result;
}

function authenticationToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    const output = execFileSync(
      "corepack",
      ["pnpm", "exec", "wrangler", "auth", "token", "--json"],
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

async function resolveZoneId(token, accountId, zoneName) {
  const query = new URLSearchParams({
    name: zoneName,
    "account.id": accountId,
    status: "active",
  });
  const zones = await apiRequest(token, `/zones?${query}`);
  if (
    !Array.isArray(zones) ||
    zones.length !== 1 ||
    typeof zones[0]?.id !== "string"
  ) {
    throw new Error(
      `Expected exactly one active ${zoneName} zone in the configured account`,
    );
  }
  return zones[0].id;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const disable = process.argv.includes("--disable");
  if (apply && disable)
    throw new Error("Use either --apply or --disable, not both");

  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  const zoneName = requiredEnvironment("CLOUDFLARE_ZONE_NAME");
  const hostname = hostnameFromOrigin(requiredEnvironment("PUBLIC_ORIGIN"));
  const script =
    process.env.CLOUDFLARE_PUBLIC_WORKER_SCRIPT?.trim() ||
    "latex-renderer-public-web";
  const enabled = !disable;
  const options = {
    patterns: desiredPublicWorkerPatterns(hostname),
    script,
    enabled,
  };
  const token = authenticationToken();
  const zoneId = await resolveZoneId(token, accountId, zoneName);
  const routesPath = `/zones/${zoneId}/workers/routes`;
  const before = await apiRequest(token, routesPath);
  const plan = planPublicWorkerRoutes(before, options);

  if (plan.create.length === 0 && plan.remove.length === 0) {
    console.log(
      `Public Worker Routes already ${enabled ? "match" : "are disabled"}.`,
    );
    return;
  }
  if (!apply && !disable) {
    console.error(
      `Public Worker Routes differ (create ${plan.create.length}, remove ${plan.remove.length}); rerun with --apply.`,
    );
    process.exitCode = 2;
    return;
  }

  for (const pattern of plan.create) {
    await apiRequest(token, routesPath, "POST", { pattern, script });
  }
  for (const route of plan.remove) {
    await apiRequest(token, `${routesPath}/${route.id}`, "DELETE");
  }

  const readback = await apiRequest(token, routesPath);
  if (!routesMatch(readback, options))
    throw new Error("Public Worker Route read-back verification failed");
  console.log(
    `Public Worker Routes ${enabled ? "updated" : "disabled"} and verified ` +
      `(created ${plan.create.length}, removed ${plan.remove.length}).`,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  await main();
}
