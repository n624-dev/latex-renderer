import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";
import { validStableVersion } from "../scripts/release-version.mjs";

const repository = "n624-dev/latex-renderer";
const [tag, destination, ...unused] = process.argv.slice(2);
if (!tag?.startsWith("v") || !destination || unused.length !== 0)
  throw new Error(
    "Usage: node deploy/winget/published-manifest.mjs vX.Y.Z MANIFEST_DIRECTORY",
  );

const version = validStableVersion(tag.slice(1));
const release = JSON.parse(
  github(["api", `repos/${repository}/releases/tags/${tag}`]),
);
if (
  release.tag_name !== tag ||
  release.immutable !== true ||
  release.draft !== false ||
  release.prerelease !== false
)
  throw new Error("WinGet accepts only published immutable Stable releases");

const commit = github([
  "api",
  `repos/${repository}/commits/${tag}`,
  "--jq",
  ".sha",
]).trim();
if (!/^[a-f0-9]{40}$/.test(commit))
  throw new Error("Release tag does not resolve to a commit");

const stage = await mkdtemp(join(tmpdir(), "n624-winget-published-"));
try {
  for (const architecture of ["x64", "arm64"]) {
    const name = `n624-latex-${version}-windows-${architecture}.zip`;
    const assets = release.assets?.filter((asset) => asset.name === name);
    const asset = assets?.length === 1 ? assets[0] : undefined;
    if (
      asset?.browser_download_url !==
        `https://github.com/${repository}/releases/download/${tag}/${name}` ||
      !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 1 ||
      asset.size > 100 * 1024 ** 2
    )
      throw new Error(
        `Invalid immutable WinGet ZIP metadata for ${architecture}`,
      );
    github([
      "release",
      "download",
      tag,
      "--repo",
      repository,
      "--pattern",
      name,
      "--dir",
      stage,
    ]);
    const local = join(stage, name);
    if ((await stat(local)).size !== asset.size)
      throw new Error(`WinGet ZIP size mismatch for ${architecture}`);
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(local)) hash.update(chunk);
    if (`sha256:${hash.digest("hex")}` !== asset.digest)
      throw new Error(`WinGet ZIP checksum mismatch for ${architecture}`);
    github([
      "attestation",
      "verify",
      local,
      "--repo",
      repository,
      "--signer-workflow",
      `${repository}/.github/workflows/server-release.yml`,
      "--source-ref",
      `refs/tags/${tag}`,
      "--source-digest",
      commit,
      "--predicate-type",
      "https://slsa.dev/provenance/v1",
      "--deny-self-hosted-runners",
    ]);
  }
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL("write-manifest.mjs", import.meta.url)),
      version,
      stage,
      resolve(destination),
    ],
    { stdio: "inherit", timeout: 120_000 },
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}

function github(args) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 8 * 1024 ** 2,
    stdio: ["ignore", "pipe", "inherit"],
  });
}
