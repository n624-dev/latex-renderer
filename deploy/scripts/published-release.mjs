import { createHash } from "node:crypto";
import { open, writeFile, lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { validReleaseVersion, isReleaseCandidate } from "./release-version.mjs";
import { releaseAttestationArgs } from "./release-attestation.mjs";
import { validateReleaseArchive } from "./release-archive.mjs";

const repo = "n624-dev/latex-renderer";
async function responseBytes(url, maximum) {
  const response = await globalThis.fetch(url, {
    signal: globalThis.AbortSignal.timeout(120_000),
    headers: { "User-Agent": "latex-renderer-bootstrap" },
  });
  if (!response.ok || !response.body)
    throw new Error(`Release request failed: HTTP ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximum) throw new Error("Release metadata exceeds limit");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
const github = async (path) =>
  JSON.parse(
    (
      await responseBytes(
        `https://api.github.com/repos/${repo}/${path}`,
        8 * 1024 ** 2,
      )
    ).toString(),
  );

export async function downloadPublishedRelease(requested, stage) {
  const version = validReleaseVersion(requested.replace(/^v/, "")),
    tag = `v${version}`;
  const release = await github(`releases/tags/${tag}`);
  if (
    release?.draft !== false ||
    release.immutable !== true ||
    release.tag_name !== tag ||
    release.prerelease !== isReleaseCandidate(version)
  )
    throw new Error("Bootstrap accepts only immutable published releases");
  const name = `latex-renderer-server-${version}.tar.gz`;
  const assets = release.assets?.filter((a) => a.name === name);
  const asset = assets?.length === 1 ? assets[0] : null;
  const url = `https://github.com/${repo}/releases/download/${tag}/${name}`;
  if (
    !asset ||
    asset.browser_download_url !== url ||
    !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") ||
    !Number.isSafeInteger(asset.size) ||
    asset.size < 1 ||
    asset.size > 1024 ** 3
  )
    throw new Error("Invalid immutable release asset");
  let object = (await github(`git/ref/tags/${tag}`)).object;
  for (let depth = 0; object?.type === "tag" && depth < 4; depth++) {
    if (!/^[a-f0-9]{40}$/.test(object.sha ?? ""))
      throw new Error("Invalid release tag object");
    object = (await github(`git/tags/${object.sha}`)).object;
  }
  if (object?.type !== "commit" || !/^[a-f0-9]{40}$/.test(object.sha ?? ""))
    throw new Error("Release tag has no commit");
  const artifact = join(stage, name),
    handle = await open(artifact, "wx", 0o600);
  const hash = createHash("sha256");
  let size = 0;
  try {
    const response = await globalThis.fetch(url, {
      signal: globalThis.AbortSignal.timeout(120_000),
    });
    if (!response.ok || !response.body)
      throw new Error("Release download failed");
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > asset.size) throw new Error("Release exceeds expected size");
      hash.update(chunk);
      let offset = 0;
      while (offset < chunk.length) {
        const written = await handle.write(
          chunk,
          offset,
          chunk.length - offset,
        );
        if (!written.bytesWritten)
          throw new Error("Release write made no progress");
        offset += written.bytesWritten;
      }
    }
  } finally {
    await handle.close();
  }
  if (size !== asset.size || `sha256:${hash.digest("hex")}` !== asset.digest)
    throw new Error("Release checksum mismatch");
  const proof = await github(
    `attestations/${encodeURIComponent(asset.digest)}`,
  );
  if (
    !Array.isArray(proof.attestations) ||
    !proof.attestations.length ||
    proof.attestations.length > 30
  )
    throw new Error("Release attestation missing");
  const bundle = join(stage, "attestation.jsonl");
  await writeFile(
    bundle,
    proof.attestations.map((a) => JSON.stringify(a.bundle)).join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  const gh = "/usr/local/bin/gh",
    info = await lstat(gh);
  if (!info.isFile() || info.uid !== 0 || info.mode & 0o022)
    throw new Error("GitHub verifier must be root-owned");
  execFileSync(
    gh,
    releaseAttestationArgs({ artifact, tag, commit: object.sha, bundle }),
    {
      stdio: "inherit",
      timeout: 120_000,
      env: {
        PATH: "/usr/local/bin:/usr/bin:/bin",
        HOME: stage,
        GH_CONFIG_DIR: stage,
        GH_PROMPT_DISABLED: "1",
      },
    },
  );
  const topLevel = `latex-renderer-server-${version}`;
  await validateReleaseArchive({
    bundle: artifact,
    topLevel,
    maxEntries: 50_000,
    maxExpandedBytes: 2 * 1024 ** 3,
    maxExpandedFileBytes: 256 * 1024 ** 2,
  });
  execFileSync(
    "/usr/bin/tar",
    ["-xzf", artifact, "--no-same-owner", "--no-same-permissions", "-C", stage],
    { timeout: 120_000 },
  );
  return { source: join(stage, topLevel), version, commit: object.sha };
}
