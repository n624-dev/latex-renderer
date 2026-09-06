import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assertValidatedCandidateTag,
  compareReleaseVersions,
  isReleaseCandidate,
  validReleaseVersion,
  validStableVersion,
} from "../deploy/scripts/release-version.mjs";
import { verifyPromotionContent } from "../deploy/scripts/verify-release-candidate-promotion.mjs";

describe("application release versions", () => {
  it("keeps the active RC string out of stable executable test fixtures", () => {
    const metadata: unknown = JSON.parse(readFileSync("package.json", "utf8"));
    const version =
      typeof metadata === "object" &&
      metadata !== null &&
      "version" in metadata &&
      typeof metadata.version === "string"
        ? metadata.version
        : undefined;
    if (!version?.includes("-rc.")) return;
    const result = spawnSync(
      "git",
      ["grep", "-l", "--fixed-strings", version, "--", "."],
      { encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    const paths = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    for (const path of paths) {
      const allowed =
        path === "CHANGELOG.md" ||
        path === "client/mcpb/manifest.json" ||
        path === "docs/public/self-hosting.md" ||
        path === "openapi/admin.openapi.yaml" ||
        path === "package.json" ||
        path === "packages/shared/src/version.ts" ||
        path === "tests/markdown-docs.test.ts" ||
        /^(?:apps|packages)\/[^/]+\/package\.json$/.test(path);
      expect(allowed, `unexpected active RC string in ${path}`).toBe(true);
    }
  });

  it("accepts stable and numbered rc versions with strict numeric components", () => {
    expect(validStableVersion("7.8.9")).toBe("7.8.9");
    expect(validReleaseVersion("7.8.9-rc.1")).toBe("7.8.9-rc.1");
    expect(isReleaseCandidate("7.8.9-rc.1")).toBe(true);
    for (const invalid of [
      "v7.8.9",
      "01.3.3",
      "1.03.3",
      "1.3.03",
      "7.8.9-rc.0",
      "7.8.9-beta.1",
      "7.8.9-rc.01",
    ]) {
      expect(() => validReleaseVersion(invalid)).toThrow();
    }
  });

  it("orders candidates before their stable release and by rc number", () => {
    expect(compareReleaseVersions("7.8.9-rc.1", "7.8.9-rc.2")).toBeLessThan(0);
    expect(compareReleaseVersions("7.8.9-rc.2", "7.8.9")).toBeLessThan(0);
    expect(compareReleaseVersions("7.8.9", "7.8.9-rc.2")).toBeGreaterThan(0);
    expect(compareReleaseVersions("7.9.0-rc.1", "7.8.9")).toBeGreaterThan(0);
  });

  it("requires stable metadata to identify a same-core validated RC", () => {
    expect(() =>
      assertValidatedCandidateTag("v7.8.9-rc.2", "7.8.9"),
    ).not.toThrow();
    expect(() => assertValidatedCandidateTag(null, "7.8.9-rc.2")).not.toThrow();
    expect(() => assertValidatedCandidateTag(null, "1.3.2")).not.toThrow();
    expect(() => assertValidatedCandidateTag(null, "7.8.9")).toThrow(
      "missing its validated candidate tag",
    );
    expect(() => assertValidatedCandidateTag("v7.8.10-rc.1", "7.8.9")).toThrow(
      "invalid validated candidate tag",
    );
    expect(() =>
      assertValidatedCandidateTag("v7.8.9-rc.1", "7.8.9-rc.2"),
    ).toThrow("must not claim another candidate");
  });

  it("allows only exact version replacement outside documentation", () => {
    expect(() =>
      verifyPromotionContent({
        path: "package.json",
        candidateContent: '{"version":"7.8.9-rc.1"}\n',
        stableContent: '{"version":"7.8.9"}\n',
        candidateVersion: "7.8.9-rc.1",
        stableVersion: "7.8.9",
      }),
    ).not.toThrow();
    expect(() =>
      verifyPromotionContent({
        path: "deploy/scripts/update-manager.mjs",
        candidateContent: "const safe = true;\n",
        stableContent: "const safe = false;\n",
        candidateVersion: "7.8.9-rc.1",
        stableVersion: "7.8.9",
      }),
    ).toThrow("more than the exact version string");
    expect(() =>
      verifyPromotionContent({
        path: "docs/public/self-hosting.md",
        candidateContent: "candidate docs\n",
        stableContent: "stable docs\n",
        candidateVersion: "7.8.9-rc.1",
        stableVersion: "7.8.9",
      }),
    ).toThrow("more than the exact version string");
    expect(() =>
      verifyPromotionContent({
        path: "docs/public/self-hosting.md",
        candidateContent: "Release 7.8.9-rc.1\n",
        stableContent: "Release 7.8.9\n",
        candidateVersion: "7.8.9-rc.1",
        stableVersion: "7.8.9",
      }),
    ).not.toThrow();
  });

  it("accepts a same-source stable promotion and rejects functional drift", () => {
    const verifier = fileURLToPath(
      new URL(
        "../deploy/scripts/verify-release-candidate-promotion.mjs",
        import.meta.url,
      ),
    );
    for (const functionalDrift of [false, true]) {
      const root = mkdtempSync(join(tmpdir(), "latex-promotion-test-"));
      try {
        runGit(root, "init", "--quiet");
        runGit(root, "config", "user.name", "Release Test");
        runGit(root, "config", "user.email", "release-test@example.invalid");
        writeFileSync(join(root, "package.json"), '{"version":"2.0.0-rc.1"}\n');
        writeFileSync(join(root, "server.mjs"), "export const safe = true;\n");
        writeFileSync(join(root, "README.md"), "candidate documentation\n");
        runGit(root, "add", ".");
        runGit(root, "commit", "--quiet", "-m", "candidate");
        runGit(root, "tag", "v2.0.0-rc.1");

        writeFileSync(join(root, "package.json"), '{"version":"2.0.0"}\n');
        writeFileSync(join(root, "README.md"), "stable documentation\n");
        if (functionalDrift)
          writeFileSync(
            join(root, "server.mjs"),
            "export const safe = false;\n",
          );
        runGit(root, "add", ".");
        runGit(root, "commit", "--quiet", "-m", "stable");
        runGit(root, "tag", "v2.0.0");

        const result = spawnSync(
          process.execPath,
          [verifier, "v2.0.0-rc.1", "v2.0.0"],
          { cwd: root, encoding: "utf8" },
        );
        if (functionalDrift) {
          expect(result.status).toBe(1);
          expect(result.stderr).toContain(
            "changes more than the exact version string: server.mjs",
          );
        } else {
          expect(result.status, result.stderr).toBe(0);
        }
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
  });
});

function runGit(root: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
