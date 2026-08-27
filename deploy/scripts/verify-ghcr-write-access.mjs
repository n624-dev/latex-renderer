#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const requestTimeoutMs = 30_000;

function deniedMessage(repositoryPath) {
  return `GHCR denied package write access for ${repositoryPath}. In the package settings, add the workflow repository under Manage Actions access with the Write role. Connecting the repository or granting Manage access is not sufficient.`;
}

export function registryAccessClaims(registryToken) {
  if (typeof registryToken !== "string" || !registryToken) {
    throw new Error("GHCR token response did not include a registry token");
  }
  const parts = registryToken.split(".");
  if (parts.length !== 3) throw new Error("GHCR returned an unrecognized registry token");
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    if (!claims || typeof claims !== "object") throw new Error("invalid claims");
    return claims;
  } catch {
    throw new Error("GHCR returned an invalid registry token");
  }
}

export function hasRepositoryAction(claims, repositoryPath, action) {
  return Array.isArray(claims.access) && claims.access.some((entry) =>
    entry?.type === "repository" &&
    entry?.name === repositoryPath &&
    Array.isArray(entry.actions) &&
    entry.actions.includes(action));
}

export async function verifyGhcrWriteAccess({ repository, actor, token, fetchImpl = globalThis.fetch }) {
  const match = /^ghcr\.io\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]+)$/.exec(repository);
  if (!match) throw new Error("GHCR repository must be ghcr.io/OWNER/PACKAGE");
  if (typeof actor !== "string" || !actor || typeof token !== "string" || !token) {
    throw new Error("GHCR actor and token are required");
  }
  const repositoryPath = `${match[1]}/${match[2]}`;
  const response = await fetchImpl(
    `https://ghcr.io/token?service=ghcr.io&scope=${encodeURIComponent(`repository:${repositoryPath}:pull,push`)}`,
    {
      headers: { Authorization: `Basic ${Buffer.from(`${actor}:${token}`).toString("base64")}` },
      signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
    },
  );
  if (response.status === 401 || response.status === 403) {
    throw new Error(deniedMessage(repositoryPath));
  }
  if (!response.ok) throw new Error(`GHCR write-access token request failed: ${response.status}`);
  const body = await response.json();
  const claims = registryAccessClaims(body?.token ?? body?.access_token);
  if (!hasRepositoryAction(claims, repositoryPath, "push")) {
    throw new Error(deniedMessage(repositoryPath));
  }
  process.stdout.write(`GHCR package write access is available for ${repositoryPath}.\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyGhcrWriteAccess({
    repository: process.argv[2] ?? "",
    actor: process.env.GHCR_ACTOR ?? "",
    token: process.env.GHCR_TOKEN ?? "",
  });
}
