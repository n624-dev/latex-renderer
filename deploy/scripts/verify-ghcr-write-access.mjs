#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const requestTimeoutMs = 30_000;

function deniedMessage(repositoryPath) {
  return `GHCR denied package write access for ${repositoryPath}. In the package settings, add the workflow repository under Manage Actions access with the Write role. Connecting the repository or granting Manage access is not sufficient.`;
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
  const registryToken = body?.token ?? body?.access_token;
  if (typeof registryToken !== "string" || !registryToken) {
    throw new Error("GHCR token response did not include a registry token");
  }

  // Registry bearer tokens may be opaque. Exercise actual push permission by
  // mounting a blob that is already linked to this same repository. A
  // successful same-repository mount creates no tag, manifest, layer, or
  // package version; a token without push permission is rejected at the mount.
  const authorization = { Authorization: `Bearer ${registryToken}` };
  const manifestResponse = await fetchImpl(
    `https://ghcr.io/v2/${repositoryPath}/manifests/latest`,
    {
      headers: {
        ...authorization,
        Accept: "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
      },
      signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
    },
  );
  if (!manifestResponse.ok) {
    throw new Error(`GHCR write-access probe could not read the existing latest manifest: ${manifestResponse.status}`);
  }
  const manifest = await manifestResponse.json();
  const blobDigest = manifest?.config?.digest;
  if (typeof blobDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(blobDigest)) {
    throw new Error("GHCR latest must be a single-platform image manifest with a valid config digest");
  }
  const blobResponse = await fetchImpl(
    `https://ghcr.io/v2/${repositoryPath}/blobs/${blobDigest}`,
    {
      method: "HEAD",
      headers: authorization,
      signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
    },
  );
  if (!blobResponse.ok) {
    throw new Error(`GHCR write-access probe could not read its existing config blob: ${blobResponse.status}`);
  }
  const mountResponse = await fetchImpl(
    `https://ghcr.io/v2/${repositoryPath}/blobs/uploads/?mount=${encodeURIComponent(blobDigest)}&from=${encodeURIComponent(repositoryPath)}`,
    {
      method: "POST",
      headers: authorization,
      redirect: "manual",
      signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
    },
  );
  if (mountResponse.status === 401 || mountResponse.status === 403) {
    throw new Error(deniedMessage(repositoryPath));
  }
  if (mountResponse.status !== 201) {
    throw new Error(`GHCR write-access blob mount returned an unexpected response: ${mountResponse.status}`);
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
