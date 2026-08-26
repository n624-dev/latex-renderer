#!/usr/bin/env node

const token = process.env.GITHUB_TOKEN;
const owner = process.env.GHCR_OWNER ?? "n624-dev";
const packageName = process.env.GHCR_PACKAGE ?? "latex-renderer-texlive";
const ownerType = process.env.GHCR_OWNER_TYPE === "orgs" ? "orgs" : "users";
const tag = process.argv[2];
const requestTimeoutMs = 30_000;

if (!token) throw new Error("GITHUB_TOKEN is required");
if (!tag || !/^[A-Za-z0-9._-]{1,128}$/.test(tag)) throw new Error("A valid tag argument is required");

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "latex-renderer-ghcr-tag-status",
};
const packagePath = encodeURIComponent(packageName);
const baseUrl = `https://api.github.com/${ownerType}/${encodeURIComponent(owner)}/packages/container/${packagePath}/versions`;

for (let page = 1; ; page += 1) {
  const response = await globalThis.fetch(`${baseUrl}?per_page=100&page=${page}`, {
    headers,
    signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
  });
  if (response.status === 404) {
    // The package itself has not been created yet, so the tag is absent.
    process.stdout.write("absent\n");
    process.exit(0);
  }
  if (!response.ok) {
    throw new Error(`GHCR version list failed: ${response.status} ${await response.text()}`);
  }
  const batch = await response.json();
  if (!Array.isArray(batch)) throw new Error("Unexpected GHCR version response");
  for (const version of batch) {
    const tags = version?.metadata?.container?.tags;
    if (Array.isArray(tags) && tags.includes(tag)) {
      process.stdout.write("present\n");
      process.exit(0);
    }
  }
  if (batch.length < 100) {
    process.stdout.write("absent\n");
    process.exit(0);
  }
}
