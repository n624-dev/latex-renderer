import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const [baseUrl, localMetadataPath, archiveOutputPath, releaseId] =
  process.argv.slice(2);
if (
  baseUrl === undefined ||
  localMetadataPath === undefined ||
  archiveOutputPath === undefined ||
  releaseId === undefined
) {
  process.stderr.write(
    "usage: verify-public-mcpb-assets.mjs BASE_URL LOCAL_METADATA ARCHIVE_OUTPUT RELEASE_ID\n",
  );
  process.exit(64);
}

const expected = parseMetadata(await readFile(localMetadataPath, "utf8")),
  attempts = 24;
let lastFailure = "not fetched";
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const suffix = `release=${encodeURIComponent(releaseId)}&attempt=${attempt}&fresh=${Date.now()}`,
      metadataResponse = await globalThis.fetch(
        `${baseUrl}/mcpb.json?${suffix}`,
        request(),
      );
    if (!metadataResponse.ok)
      throw new Error(`metadata returned HTTP ${metadataResponse.status}`);
    const published = parseMetadata(await metadataResponse.text());
    if (
      published.archive !== expected.archive ||
      published.size !== expected.size ||
      published.sha256 !== expected.sha256
    )
      throw new Error("published MCPB metadata does not match this release");
    const archiveResponse = await globalThis.fetch(
      `${baseUrl}/${encodeURIComponent(expected.archive)}?${suffix}`,
      request(),
    );
    if (!archiveResponse.ok)
      throw new Error(`archive returned HTTP ${archiveResponse.status}`);
    const archive = Buffer.from(await archiveResponse.arrayBuffer()),
      digest = createHash("sha256").update(archive).digest("hex");
    if (archive.byteLength !== expected.size || digest !== expected.sha256)
      throw new Error("published MCPB integrity check failed");
    await writeFile(archiveOutputPath, archive);
    process.stdout.write(digest);
    process.exit(0);
  } catch (error) {
    lastFailure = error instanceof Error ? error.message : String(error);
    if (attempt < attempts) await delay(5_000);
  }
}
throw new Error(
  `Published MCPB assets did not converge after ${attempts} attempts: ${lastFailure}`,
);

function parseMetadata(text) {
  const value = JSON.parse(text);
  if (
    typeof value !== "object" ||
    value === null ||
    !/^latex-renderer-local-\d+\.\d+\.\d+\.mcpb$/.test(value.archive) ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0
  )
    throw new Error("MCPB metadata is invalid");
  return value;
}

function request() {
  return {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(15_000),
  };
}
