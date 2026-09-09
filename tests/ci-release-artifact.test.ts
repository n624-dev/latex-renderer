import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { releaseAttestationArgs } from "../deploy/scripts/release-attestation.mjs";
import { verifyCiReleaseArtifact } from "../deploy/scripts/ci-release-artifact.mjs";

const roots: string[] = [];
const tag = "v9.2.0-rc.1",
  commit = "a".repeat(40);
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(overrides: Record<string, unknown> = {}) {
  const root = await mkdtemp(join(tmpdir(), "ci-release-artifact-"));
  roots.push(root);
  const top = `latex-renderer-server-${tag.slice(1)}`;
  const source = join(root, top);
  await mkdir(source);
  await writeFile(
    join(source, ".latex-renderer-release.json"),
    JSON.stringify({
      schemaVersion: 1,
      tag,
      commit,
      version: tag.slice(1),
      repository: "n624-dev/latex-renderer",
      requiredNodeMajor: 24,
      packageManager: "pnpm@11.0.0",
      validatedCandidateTag: null,
      provenance: "github-artifact-attestation",
      ...overrides,
    }),
  );
  await writeFile(
    join(source, "package.json"),
    JSON.stringify({
      version: tag.slice(1),
      packageManager: "pnpm@11.0.0",
    }),
  );
  const artifact = join(root, "candidate.tar.gz");
  execFileSync("tar", ["-czf", artifact, "-C", root, top]);
  const digest = `sha256:${createHash("sha256")
    .update(await readFile(artifact))
    .digest("hex")}`;
  return { artifact, tag, commit, digest };
}

it("pins both entries to the same repository, workflow, tag and commit", () => {
  const args = releaseAttestationArgs({
    artifact: "/artifact.tar.gz",
    tag,
    commit,
  });
  expect(args).toEqual([
    "attestation",
    "verify",
    "/artifact.tar.gz",
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
  ]);
  expect(
    releaseAttestationArgs({ artifact: "/a", tag, commit, bundle: "/proof" }),
  ).toContain("--bundle");
});

it.each([
  { tag: "../evil" },
  { tag: "v9.2.0-beta.1" },
  { commit: "main" },
  { commit: "b".repeat(39) },
  { artifact: "--help" },
  { bundle: "relative" },
])("rejects unpinned inputs before verification: %j", (invalid) => {
  expect(() =>
    releaseAttestationArgs({ artifact: "/a", tag, commit, ...invalid }),
  ).toThrow();
});

it("accepts a matching fixture only after the verifier succeeds (mock signature)", async () => {
  const pin = await fixture();
  const verify = vi.fn();
  await expect(verifyCiReleaseArtifact(pin, verify)).resolves.toEqual({
    tag,
    commit,
    digest: pin.digest,
  });
  expect(verify).toHaveBeenCalledExactlyOnceWith(releaseAttestationArgs(pin));
});

it("never parses or accepts an artifact after signature verification fails", async () => {
  const pin = await fixture();
  await expect(
    verifyCiReleaseArtifact(pin, () => {
      throw new Error("untrusted signature");
    }),
  ).rejects.toThrow("untrusted signature");
});

it("passes a portable proof to the same source-pinned verifier (mock signature)", async () => {
  const pin = await fixture();
  const verify = vi.fn();
  await verifyCiReleaseArtifact(
    { ...pin, attestationBundle: "/proof.jsonl" },
    verify,
  );
  expect(verify).toHaveBeenCalledExactlyOnceWith(
    releaseAttestationArgs({ ...pin, bundle: "/proof.jsonl" }),
  );
});

it("rejects a changed artifact before invoking the verifier", async () => {
  const pin = await fixture();
  await writeFile(pin.artifact, "changed");
  const verify = vi.fn();
  await expect(verifyCiReleaseArtifact(pin, verify)).rejects.toThrow("digest");
  expect(verify).not.toHaveBeenCalled();
});

it("rejects a symlink artifact before invoking the verifier", async () => {
  const pin = await fixture();
  const link = `${pin.artifact}.link`;
  await symlink(pin.artifact, link);
  const verify = vi.fn();
  await expect(
    verifyCiReleaseArtifact({ ...pin, artifact: link }, verify),
  ).rejects.toThrow("regular file");
  expect(verify).not.toHaveBeenCalled();
});

it.each([
  { commit: "b".repeat(40) },
  { repository: "other/repository" },
  { schemaVersion: 2 },
  { requiredNodeMajor: 99 },
  { tag: "v9.3.0-rc.1" },
])(
  "rejects mismatched envelope even with mocked valid signature: %j",
  async (override) => {
    await expect(
      verifyCiReleaseArtifact(await fixture(override), vi.fn()),
    ).rejects.toThrow("metadata");
  },
);

it("keeps the CI entry read-only and outside the production helper dispatch", async () => {
  for (const name of ["update-manager.mjs", "update-manager-helper.mjs"]) {
    const source = await readFile(`deploy/scripts/${name}`, "utf8");
    expect(source).toContain("Draft releases cannot be installed");
    expect(source).toContain("release?.immutable !== true");
    expect(source).toContain("releaseAttestationArgs({");
    expect(source).not.toContain("ci-release-artifact");
  }
  const workflow = await readFile(
    ".github/workflows/server-release.yml",
    "utf8",
  );
  expect(
    workflow.indexOf("node deploy/scripts/ci-release-artifact.mjs"),
  ).toBeLessThan(workflow.indexOf("gh release upload"));
  expect(workflow).toContain("sha256sum --strict --check");
  expect(workflow).not.toContain("pull_request:");
});
