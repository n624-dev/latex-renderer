import { validReleaseVersion } from "./release-version.mjs";

// Transport is deliberately absent: production obtains immutable published
// assets, while release CI verifies its local, not-yet-published artifact.
// Both must prove the same publisher, workflow, tag AND source commit.
export function releaseAttestationArgs({ artifact, tag, commit, bundle }) {
  if (
    typeof tag !== "string" ||
    !tag.startsWith("v") ||
    `v${validReleaseVersion(tag.slice(1))}` !== tag ||
    typeof commit !== "string" ||
    !/^[a-f0-9]{40}$/.test(commit) ||
    typeof artifact !== "string" ||
    !artifact.startsWith("/") ||
    (bundle !== undefined &&
      (typeof bundle !== "string" || !bundle.startsWith("/")))
  )
    throw new Error("Invalid pinned release attestation input");
  return [
    "attestation",
    "verify",
    artifact,
    ...(bundle === undefined ? [] : ["--bundle", bundle]),
    "--repo",
    "n624-dev/latex-renderer",
    "--signer-workflow",
    "n624-dev/latex-renderer/.github/workflows/server-release.yml",
    "--source-ref",
    `refs/tags/${tag}`,
    "--source-digest",
    commit,
    "--predicate-type",
    "https://slsa.dev/provenance/v1",
    "--deny-self-hosted-runners",
  ];
}
