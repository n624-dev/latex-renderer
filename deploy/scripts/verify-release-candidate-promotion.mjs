#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  isReleaseCandidate,
  validReleaseVersion,
  validStableVersion,
} from "./release-version.mjs";

const documentationPaths = new Set([
  "CHANGELOG.md",
  "DEPLOYMENT.md",
  "README.md",
  "SETUP.md",
]);

export function verifyPromotionContent({
  path,
  candidateContent,
  stableContent,
  candidateVersion,
  stableVersion,
}) {
  if (documentationPaths.has(path)) return;
  if (candidateContent === null || stableContent === null)
    throw new Error(
      `Stable promotion may not add or remove executable source: ${path}`,
    );
  const normalized = candidateContent
    .split(candidateVersion)
    .join(stableVersion);
  if (normalized !== stableContent)
    throw new Error(
      `Stable promotion changes more than the exact version string: ${path}`,
    );
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    cwd: options.cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function fileAt(repositoryRoot, revision, path) {
  try {
    return git(["show", `${revision}:${path}`], { cwd: repositoryRoot });
  } catch (error) {
    if (error?.status === 128) return null;
    throw error;
  }
}

export function verifyReleaseCandidatePromotion(
  candidateTag,
  stableTag,
  repositoryRoot = process.cwd(),
) {
  if (!candidateTag.startsWith("v") || !stableTag.startsWith("v"))
    throw new Error("Release tags must start with v");
  const candidateVersion = validReleaseVersion(candidateTag.slice(1));
  const stableVersion = validStableVersion(stableTag.slice(1));
  if (!isReleaseCandidate(candidateVersion))
    throw new Error("Candidate tag must use vX.Y.Z-rc.N");
  if (candidateVersion.replace(/-rc\.[1-9]\d*$/, "") !== stableVersion)
    throw new Error("Candidate and stable tags must share the same X.Y.Z core");

  const root = resolve(repositoryRoot);
  git(["rev-parse", "--verify", `${candidateTag}^{commit}`], { cwd: root });
  const stableCommit = git(["rev-parse", "--verify", `${stableTag}^{commit}`], {
    cwd: root,
  }).trim();
  const head = git(["rev-parse", "HEAD"], { cwd: root }).trim();
  if (stableCommit !== head)
    throw new Error("Stable tag must point at the checked-out commit");
  try {
    git(["merge-base", "--is-ancestor", candidateTag, stableTag], {
      cwd: root,
    });
  } catch {
    throw new Error(
      "Validated candidate must be an ancestor of the stable tag",
    );
  }

  const paths = git(
    [
      "diff",
      "--name-only",
      "--diff-filter=ACDMRTUXB",
      `${candidateTag}..${stableTag}`,
    ],
    { cwd: root },
  )
    .split(/\r?\n/)
    .filter(Boolean);
  if (paths.length === 0)
    throw new Error(
      "Stable promotion must at least replace the candidate version",
    );
  for (const path of paths) {
    verifyPromotionContent({
      path,
      candidateContent: fileAt(root, candidateTag, path),
      stableContent: fileAt(root, stableTag, path),
      candidateVersion,
      stableVersion,
    });
  }
}

async function main() {
  const [candidateTag, stableTag, ...extra] = process.argv.slice(2);
  if (!candidateTag || !stableTag || extra.length !== 0)
    throw new Error(
      "usage: verify-release-candidate-promotion.mjs CANDIDATE_TAG STABLE_TAG",
    );
  verifyReleaseCandidatePromotion(candidateTag, stableTag);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
