import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
    const paths = activeReleaseReferences(".", version);
    expect(paths).toContain("package.json");
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

  it("checks new source files before git add as well as after, without scanning generated outputs", () => {
    const root = mkdtempSync(join(tmpdir(), "release inventory "));
    const version = "7.8.9-rc.4";
    try {
      runGit(root, "init", "--quiet");
      writeFileSync(join(root, ".gitignore"), "**/dist/\n");
      writeFileSync(join(root, "package.json"), JSON.stringify({ version }));
      mkdirSync(join(root, "tests", "dist"), { recursive: true });
      mkdirSync(join(root, "test-results"));
      writeFileSync(join(root, "tests", "new-fixture.test.ts"), version);
      writeFileSync(join(root, "new-root.mjs"), version);
      writeFileSync(join(root, "tests", "dist", "generated.js"), version);
      writeFileSync(join(root, "test-results", "result.json"), version);
      // Tracked files stay in scope even outside the source directories.
      writeFileSync(join(root, "tracked.md"), version);
      runGit(root, "add", ".gitignore", "package.json", "tracked.md");
      const expected = [
        "new-root.mjs",
        "package.json",
        "tests/new-fixture.test.ts",
        "tracked.md",
      ];
      expect(activeReleaseReferences(root, version)).toEqual(expected);
      runGit(root, "add", "tests/new-fixture.test.ts", "new-root.mjs");
      expect(activeReleaseReferences(root, version)).toEqual(expected);
      expect(activeReleaseReferences(root, "7.8.9-rc.99")).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
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

function activeReleaseReferences(root: string, version: string): string[] {
  const paths = new Set<string>();
  // Retain the whole tracked-tree check. Also inspect untracked source and
  // root files before staging; unrelated local result directories are not
  // source, and Git's standard ignores exclude generated dist/dependencies.
  for (const untracked of [false, true]) {
    const pathspecs = untracked
      ? [
          "apps",
          "packages",
          "tests",
          "deploy",
          "client",
          ".github",
          ":(top,glob)*",
        ]
      : ["."];
    const result = spawnSync(
      "git",
      [
        "grep",
        "-l",
        "-z",
        "--fixed-strings",
        ...(untracked ? ["--untracked", "--exclude-standard"] : []),
        "-e",
        version,
        "--",
        ...pathspecs,
      ],
      { cwd: root, encoding: "utf8" },
    );
    if (result.status !== 0 && result.status !== 1)
      throw new Error(result.stderr || "Release source inventory failed");
    for (const path of result.stdout.split("\0").filter(Boolean))
      paths.add(path);
  }
  return [...paths].sort();
}

function runGit(root: string, ...args: string[]): void {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
}
