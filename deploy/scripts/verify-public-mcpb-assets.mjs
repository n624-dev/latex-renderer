import { isMainModule } from "./is-main-module.mjs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

export async function waitForPublishedMcpbAssets({
  baseUrl,
  localMetadataPath,
  archiveOutputPath,
  releaseId,
  attempts = 24,
  retryDelayMs = 5000,
  fetchImpl = globalThis.fetch,
  sleep = delay,
}) {
  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    attempts > 100 ||
    !Number.isSafeInteger(retryDelayMs) ||
    retryDelayMs < 0 ||
    retryDelayMs > 60000
  )
    throw new Error("Invalid MCPB verification retry bounds");
  const expected = parseMetadata(await readFile(localMetadataPath, "utf8"));
  let lastFailure = "not fetched";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const suffix = `release=${encodeURIComponent(releaseId)}&attempt=${attempt}&fresh=${Date.now()}`;
      const metadataResponse = await fetchImpl(
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
      const archiveResponse = await fetchImpl(
        `${baseUrl}/${encodeURIComponent(expected.archive)}?${suffix}`,
        request(),
      );
      if (!archiveResponse.ok)
        throw new Error(`archive returned HTTP ${archiveResponse.status}`);
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      const digest = createHash("sha256").update(archive).digest("hex");
      if (archive.byteLength !== expected.size || digest !== expected.sha256)
        throw new Error("published MCPB integrity check failed");
      await writeFile(archiveOutputPath, archive);
      return digest;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await sleep(retryDelayMs);
    }
  }
  throw new Error(
    `Published MCPB assets did not converge after ${attempts} attempts: ${lastFailure}`,
  );
}

if (isMainModule(import.meta.url)) {
  const [baseUrl, localMetadataPath, archiveOutputPath, releaseId, ...extra] =
    process.argv.slice(2);
  if (
    [baseUrl, localMetadataPath, archiveOutputPath, releaseId].some(
      (value) => value === undefined,
    ) ||
    extra.length
  ) {
    process.stderr.write(
      "usage: verify-public-mcpb-assets.mjs BASE_URL LOCAL_METADATA ARCHIVE_OUTPUT RELEASE_ID\n",
    );
    process.exitCode = 64;
  } else
    process.stdout.write(
      await waitForPublishedMcpbAssets({
        baseUrl,
        localMetadataPath,
        archiveOutputPath,
        releaseId,
      }),
    );
}

function parseMetadata(text) {
  const value = JSON.parse(text);
  if (
    typeof value !== "object" ||
    value === null ||
    !/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-rc\.[1-9][0-9]*)?$/.test(
      value.version,
    ) ||
    value.archive !== `latex-renderer-local-${value.version}.mcpb` ||
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
