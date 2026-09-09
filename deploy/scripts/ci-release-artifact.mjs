import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { releaseAttestationArgs } from "./release-attestation.mjs";
import { validateReleaseArchive } from "./release-archive.mjs";
import { assertValidatedCandidateTag } from "./release-version.mjs";

const maxBundleBytes = 1024 ** 3;

async function digestOf(bundle) {
  const info = await lstat(bundle);
  if (!info.isFile() || info.size < 1 || info.size > maxBundleBytes)
    throw new Error("Release artifact must be a bounded regular file");
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(bundle)) {
    size += chunk.length;
    if (size > maxBundleBytes) throw new Error("Release artifact is too large");
    hash.update(chunk);
  }
  return `sha256:${hash.digest("hex")}`;
}

// Read-only CI entry: it cannot install, invoke sudo, or grant the production
// manager permission to accept a draft. The caller pins the checked-out tag,
// commit and artifact digest; signatures are still mandatory before parsing.
export async function verifyCiReleaseArtifact(
  { artifact, tag, commit, digest, attestationBundle },
  verifyAttestation = (args) =>
    execFileSync("gh", args, {
      stdio: ["ignore", "inherit", "inherit"],
      timeout: 120_000,
    }),
) {
  const args = releaseAttestationArgs({
    artifact,
    tag,
    commit,
    bundle: attestationBundle,
  });
  if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? ""))
    throw new Error("Expected artifact SHA-256 is required");
  if ((await digestOf(artifact)) !== digest)
    throw new Error("Release artifact digest does not match CI pin");
  await verifyAttestation(args);
  const version = tag.slice(1),
    topLevel = `latex-renderer-server-${version}`;
  await validateReleaseArchive({
    bundle: artifact,
    topLevel,
    maxEntries: 50_000,
    maxExpandedBytes: 2 * 1024 ** 3,
    maxExpandedFileBytes: 256 * 1024 ** 2,
  });
  const readJson = (name) =>
    JSON.parse(
      execFileSync("tar", ["-xOzf", artifact, `${topLevel}/${name}`], {
        encoding: "utf8",
        maxBuffer: 64 * 1024,
        timeout: 30_000,
      }),
    );
  const manifest = readJson(".latex-renderer-release.json");
  const pkg = readJson("package.json");
  if (
    manifest?.schemaVersion !== 1 ||
    manifest?.version !== version ||
    manifest?.tag !== tag ||
    manifest?.commit !== commit ||
    manifest?.repository !== "n624-dev/latex-renderer" ||
    manifest?.provenance !== "github-artifact-attestation" ||
    manifest?.requiredNodeMajor !== 24 ||
    pkg?.version !== version ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(manifest?.packageManager ?? "") ||
    manifest.packageManager !== pkg?.packageManager
  )
    throw new Error("CI artifact metadata does not match pinned release");
  assertValidatedCandidateTag(manifest.validatedCandidateTag, version);
  if ((await digestOf(artifact)) !== digest)
    throw new Error("Release artifact changed during verification");
  return { tag, commit, digest };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv.length !== 6 && process.argv.length !== 7)
    throw new Error(
      "usage: ci-release-artifact.mjs ABSOLUTE_ARTIFACT TAG COMMIT sha256:DIGEST [ABSOLUTE_ATTESTATION]",
    );
  const [artifact, tag, commit, digest, attestationBundle] =
    process.argv.slice(2);
  const receipt = await verifyCiReleaseArtifact({
    artifact,
    tag,
    commit,
    digest,
    attestationBundle,
  });
  console.log(JSON.stringify(receipt));
}
