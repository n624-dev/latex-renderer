import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { validStableVersion } from "../scripts/release-version.mjs";
import { clientReleaseUrl, renderHomebrewFormula } from "./formula.mjs";

const repository = "n624-dev/latex-renderer";
const tag = process.argv[2];
if (process.argv.length !== 3 || !tag?.startsWith("v"))
  throw new Error("Usage: node deploy/homebrew/published-formula.mjs vX.Y.Z");
const version = validStableVersion(tag.slice(1));
const archive = `latex-renderer-client-${version}.zip`;
const release = JSON.parse(
  github(["api", `repos/${repository}/releases/tags/${tag}`]),
);
if (
  release.tag_name !== tag ||
  release.immutable !== true ||
  release.draft !== false ||
  release.prerelease !== false
)
  throw new Error("Homebrew accepts only published immutable Stable releases");
const assets = release.assets?.filter((asset) => asset.name === archive);
const asset = assets?.length === 1 ? assets[0] : undefined;
if (
  asset?.browser_download_url !== clientReleaseUrl(version) ||
  !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") ||
  !Number.isSafeInteger(asset.size) ||
  asset.size < 1 ||
  asset.size > 25 * 1024 ** 2
)
  throw new Error("Invalid client ZIP metadata");
const commit = github([
  "api",
  `repos/${repository}/commits/${tag}`,
  "--jq",
  ".sha",
]).trim();
if (!/^[a-f0-9]{40}$/.test(commit))
  throw new Error("Release tag does not resolve to a commit");

const stage = await mkdtemp(join(tmpdir(), "n624-homebrew-release-"));
try {
  github([
    "release",
    "download",
    tag,
    "--repo",
    repository,
    "--pattern",
    archive,
    "--dir",
    stage,
  ]);
  const local = join(stage, archive);
  const bytes = await readFile(local);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== asset.size || `sha256:${sha256}` !== asset.digest)
    throw new Error("Client ZIP checksum mismatch");
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
  process.stdout.write(renderHomebrewFormula(version, sha256));
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
