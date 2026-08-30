#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import { pathToFileURL, URL } from "node:url";

const PROFILE_KEYS = new Set([
  "ADMIN_API_URL",
  "AUTH_MODE",
  "CLOUDFLARE_ACCESS_ISSUER",
  "CLOUDFLARE_ADMIN_AUDIENCE",
  "CLOUDFLARE_REMOTE_MCP_AUDIENCE",
  "DEPLOYMENT_MODE",
  "OIDC_ALLOWED_ALGORITHMS",
  "OIDC_CLIENT_ID",
  "OIDC_ISSUER",
  "PUBLIC_ORIGIN",
  "RENDERER_PUBLIC_URL",
]);
const ASYMMETRIC_OIDC_ALGORITHMS = new Set([
  "RS256",
  "RS384",
  "RS512",
  "ES256",
  "ES384",
  "ES512",
]);

export function parseEnvironmentFile(contents) {
  if (contents.includes("\0") || contents.includes("\r"))
    throw new Error("renderer.env contains prohibited control characters");
  const values = new Map();
  const seen = new Set();
  for (const [index, line] of contents.split("\n").entries()) {
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match === null)
      throw new Error(
        `renderer.env line ${index + 1} is not a strict KEY=value entry`,
      );
    const [, key, value] = match;
    if (hasControlCharacters(value))
      throw new Error(
        `renderer.env line ${index + 1} contains prohibited control characters`,
      );
    if (seen.has(key))
      throw new Error(`renderer.env contains duplicate ${key}`);
    seen.add(key);
    if (PROFILE_KEYS.has(key)) values.set(key, value);
  }
  return values;
}

export function validateProfileValues(values) {
  const deploymentMode = required(values, "DEPLOYMENT_MODE");
  if (deploymentMode !== "cloudflare" && deploymentMode !== "standalone")
    throw new Error("DEPLOYMENT_MODE must be cloudflare or standalone");
  const authMode = required(values, "AUTH_MODE");
  if (!["cloudflare-access", "oidc", "password"].includes(authMode))
    throw new Error("AUTH_MODE must be cloudflare-access, oidc, or password");
  if (deploymentMode === "standalone" && authMode === "cloudflare-access")
    throw new Error(
      "AUTH_MODE=cloudflare-access requires DEPLOYMENT_MODE=cloudflare",
    );

  const publicOrigin = exactHttpsOrigin(
    required(values, "PUBLIC_ORIGIN"),
    "PUBLIC_ORIGIN",
  );
  if (
    exactHttpsOrigin(
      required(values, "RENDERER_PUBLIC_URL"),
      "RENDERER_PUBLIC_URL",
    ) !== publicOrigin
  )
    throw new Error("RENDERER_PUBLIC_URL must exactly equal PUBLIC_ORIGIN");
  if (
    values.has("ADMIN_API_URL") &&
    exactHttpsOrigin(required(values, "ADMIN_API_URL"), "ADMIN_API_URL") !==
      publicOrigin
  )
    throw new Error(
      "ADMIN_API_URL must exactly equal PUBLIC_ORIGIN when configured",
    );

  if (authMode === "cloudflare-access") {
    exactHttpsOrigin(
      required(values, "CLOUDFLARE_ACCESS_ISSUER"),
      "CLOUDFLARE_ACCESS_ISSUER",
    );
    for (const key of [
      "CLOUDFLARE_ADMIN_AUDIENCE",
      "CLOUDFLARE_REMOTE_MCP_AUDIENCE",
    ]) {
      const audience = required(values, key);
      if (!/^[A-Za-z0-9_-]{16,500}$/.test(audience))
        throw new Error(`${key} has an invalid format`);
    }
  } else if (authMode === "oidc") {
    strictHttpsUrl(required(values, "OIDC_ISSUER"), "OIDC_ISSUER");
    const clientId = required(values, "OIDC_CLIENT_ID");
    if (
      clientId.length > 500 ||
      [...clientId].some((character) => {
        const code = character.charCodeAt(0);
        return code <= 0x20 || code === 0x7f;
      })
    )
      throw new Error("OIDC_CLIENT_ID has an invalid format");
    const configured = values.get("OIDC_ALLOWED_ALGORITHMS");
    const algorithms =
      configured === undefined
        ? ["RS256", "ES256"]
        : configured.split(",").map((value) => value.trim());
    if (
      algorithms.length === 0 ||
      new Set(algorithms).size !== algorithms.length ||
      algorithms.some((algorithm) => !ASYMMETRIC_OIDC_ALGORITHMS.has(algorithm))
    )
      throw new Error(
        "OIDC_ALLOWED_ALGORITHMS must be a unique asymmetric allowlist",
      );
  }
  return { authMode, deploymentMode, publicOrigin };
}

function hasControlCharacters(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function required(values, key) {
  const value = values.get(key);
  if (value === undefined || value.length === 0 || value.trim() !== value)
    throw new Error(`${key} must be configured without surrounding whitespace`);
  if (/REPLACE_|example\.com|your-team/i.test(value))
    throw new Error(`${key} still contains an example placeholder`);
  return value;
}

function exactHttpsOrigin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an exact HTTPS origin`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(`${label} must be an exact HTTPS origin`);
  return url.origin;
}

function strictHttpsUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `${label} must be an HTTPS URL without credentials, query, or fragment`,
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(
      `${label} must be an HTTPS URL without credentials, query, or fragment`,
    );
  return url.toString();
}

function groupId(name) {
  const line = execFileSync("getent", ["group", name], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
  const gid = Number(line.split(":")[2]);
  if (!Number.isInteger(gid))
    throw new Error(`required group ${name} was not found`);
  return gid;
}

function assertSecureFile(path, options) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`${options.label} must be a regular non-symlink file`);
  if (
    stat.uid !== 0 ||
    stat.gid !== options.gid ||
    (stat.mode & 0o777) !== options.mode
  )
    throw new Error(`${options.label} has unsafe ownership or permissions`);
  if (stat.size < options.minimumBytes || stat.size > options.maximumBytes)
    throw new Error(`${options.label} has an invalid size`);
}

function main() {
  if (process.geteuid?.() !== 0)
    throw new Error("validate-production-profile.mjs must run as root");
  if (process.argv.length !== 3)
    throw new Error("usage: validate-production-profile.mjs RENDERER_ENV_FILE");
  const environmentPath = process.argv[2];
  const rendererGid = groupId("latex-renderer");
  assertSecureFile(environmentPath, {
    label: "renderer.env",
    gid: rendererGid,
    mode: 0o640,
    minimumBytes: 1,
    maximumBytes: 128 * 1024,
  });
  const profile = validateProfileValues(
    parseEnvironmentFile(readFileSync(environmentPath, "utf8")),
  );
  if (profile.authMode === "oidc") {
    const secretPath = "/etc/latex-renderer/secrets/oidc-client-secret";
    assertSecureFile(secretPath, {
      label: "OIDC client secret",
      gid: rendererGid,
      mode: 0o440,
      minimumBytes: 16,
      maximumBytes: 16 * 1024,
    });
    const length = readFileSync(secretPath, "utf8").trim().length;
    if (length < 16 || length > 4096)
      throw new Error("OIDC client secret has an invalid trimmed length");
  } else if (profile.authMode === "password") {
    assertSecureFile("/etc/latex-renderer/secrets/auth-password-pepper", {
      label: "password authentication pepper",
      gid: rendererGid,
      mode: 0o440,
      minimumBytes: 32,
      maximumBytes: 16 * 1024,
    });
  }
  process.stdout.write(
    `Production profile verified: ${profile.deploymentMode}/${profile.authMode}\n`,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Production profile validation failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 65;
  }
}
