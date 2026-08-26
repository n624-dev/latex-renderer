import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const archivePattern = /^latex-renderer-client-[0-9]+\.[0-9]+\.[0-9]+\.zip$/;
const hashPattern = /^[a-f0-9]{64}$/;

export async function waitForPublishedClientAssets(options) {
  const expected = parseManifest(
    await readFile(options.localManifestPath, "utf8"),
    "local",
  );
  const attempts = positiveInteger(options.attempts, 24);
  const retryDelayMs = nonnegativeInteger(options.retryDelayMs, 5_000);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleep = options.sleep ?? delay;
  let lastFailure = "assets were not fetched";

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const suffix = `release=${encodeURIComponent(options.releaseId)}&attempt=${attempt}&fresh=${Date.now()}`;
      const manifestResponse = await fetchImpl(
        `${options.clientBaseUrl}/manifest.json?${suffix}`,
        requestOptions(),
      );
      if (!manifestResponse.ok)
        throw new Error(`manifest returned HTTP ${manifestResponse.status}`);
      const manifestText = await manifestResponse.text();
      const published = parseManifest(manifestText, "published");
      if (
        published.archive !== expected.archive ||
        published.sha256 !== expected.sha256 ||
        published.size !== expected.size
      ) {
        throw new Error(
          "published manifest does not match the local release manifest",
        );
      }

      const archiveResponse = await fetchImpl(
        `${options.clientBaseUrl}/${encodeURIComponent(expected.archive)}?${suffix}`,
        requestOptions(),
      );
      if (!archiveResponse.ok)
        throw new Error(`archive returned HTTP ${archiveResponse.status}`);
      const archive = Buffer.from(await archiveResponse.arrayBuffer());
      const actualHash = createHash("sha256").update(archive).digest("hex");
      if (archive.byteLength !== expected.size) {
        throw new Error(
          `archive size is ${archive.byteLength}; expected ${expected.size}`,
        );
      }
      if (actualHash !== expected.sha256) {
        throw new Error(
          `archive SHA-256 is ${actualHash}; expected ${expected.sha256}`,
        );
      }

      await writeFile(options.archiveOutputPath, archive);
      return actualHash;
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      if (attempt < attempts) await sleep(retryDelayMs);
    }
  }

  throw new Error(
    `Published client assets did not converge after ${attempts} attempts: ${lastFailure}`,
  );
}

function parseManifest(text, source) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${source} client manifest is not valid JSON`);
  }
  if (
    value === null ||
    typeof value !== "object" ||
    !archivePattern.test(value.archive) ||
    !hashPattern.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0
  ) {
    throw new Error(`${source} client manifest is invalid`);
  }
  return { archive: value.archive, sha256: value.sha256, size: value.size };
}

function requestOptions() {
  return {
    cache: "no-store",
    headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
    redirect: "error",
    signal: globalThis.AbortSignal.timeout(15_000),
  };
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonnegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [clientBaseUrl, localManifestPath, archiveOutputPath, releaseId] =
    process.argv.slice(2);
  if (
    [clientBaseUrl, localManifestPath, archiveOutputPath, releaseId].some(
      (value) => value === undefined,
    )
  ) {
    process.stderr.write(
      "usage: verify-public-client-assets.mjs CLIENT_BASE LOCAL_MANIFEST ARCHIVE_OUTPUT RELEASE_ID\n",
    );
    process.exitCode = 64;
  } else {
    const attempts = Number.parseInt(
      process.env.LATEX_RENDER_CLIENT_ASSET_ATTEMPTS ?? "24",
      10,
    );
    const retryDelayMs = Number.parseInt(
      process.env.LATEX_RENDER_CLIENT_ASSET_RETRY_DELAY_MS ?? "5000",
      10,
    );
    waitForPublishedClientAssets({
      clientBaseUrl,
      localManifestPath,
      archiveOutputPath,
      releaseId,
      attempts,
      retryDelayMs,
    }).then(
      (hash) => process.stdout.write(hash),
      (error) => {
        process.stderr.write(
          `${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      },
    );
  }
}
