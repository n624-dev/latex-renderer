import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string): string => readFileSync(path, "utf8");

describe("public supply-chain controls", () => {
  it("keeps dependency, action, and container update streams enabled", () => {
    const dependabot = read(".github/dependabot.yml");
    expect(dependabot).toContain("package-ecosystem: npm");
    expect(dependabot).toContain("package-ecosystem: github-actions");
    expect(dependabot).toContain("package-ecosystem: docker");
    expect(read(".github/workflows/ci.yml")).toContain(
      "gitleaks/gitleaks-action@",
    );
    const security = read(".github/workflows/security.yml");
    expect(security).toContain("github/codeql-action/init@");
    expect(security).toContain("languages: javascript-typescript");
    expect(security).toContain("dependency-audit:");
    expect(security).toContain("pnpm audit --prod --audit-level=high");
    expect(security).toContain("aquasecurity/trivy-action@");
    expect(security).toContain("anchore/sbom-action@");
  });

  it("pins the Windows toolchain and records a reproducible Debian inventory", () => {
    const mcpb = read(".github/workflows/mcpb.yml");
    expect(mcpb).toContain(
      "choco install openssl --version=$opensslVersion --exact",
    );
    expect(mcpb).toContain("Expected OpenSSL $opensslVersion");
    for (const path of ["renderer/Dockerfile", "renderer/Dockerfile.base"]) {
      const dockerfile = read(path);
      expect(dockerfile).toContain("FROM debian:bookworm-slim@sha256:");
      expect(dockerfile).toContain("ARG DEBIAN_SNAPSHOT=20260812T235959Z");
      expect(dockerfile).toContain("mkdir -p /opt/renderer");
      expect(dockerfile).toContain("dpkg-query -W -f='");
      expect(dockerfile).toContain("debian-packages.txt");
    }
  });

  it("never uses a GHCR tag as the Base/Runtime build authority", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    expect(manager).toContain("ref: matchingDigest ?? info.Id");
    expect(manager).toContain("const immutableRef = matchingDigest ?? info.Id");
    const workflow = read(".github/workflows/renderer-image-daily.yml");
    expect(workflow).toContain('ghcr-tag-status.mjs "${runtime_tags[$index]}"');
    expect(workflow).toContain(
      "refusing to overwrite an immutable publication",
    );
    expect(workflow).toContain(
      'docker pull "$IMAGE_REPOSITORY@$runtime_digest"',
    );
  });

  it("binds releases to the protected keyless attestation workflow", () => {
    const release = read(".github/workflows/server-release.yml");
    expect(release).toContain("actions/attest-build-provenance@");
    expect(release).toContain(
      "--signer-workflow n624-dev/latex-renderer/.github/workflows/server-release.yml",
    );
    expect(release).toContain("--deny-self-hosted-runners");
    const updater = read("deploy/scripts/update-manager.mjs");
    expect(updater).toContain('const githubCli = "/usr/local/bin/gh"');
    expect(updater).toContain('"attestation",');
    expect(updater).toContain('"--predicate-type",');
    expect(release).toContain('[[ "$GITHUB_REF" == "refs/tags/$RELEASE_TAG" ]]');
    const installer = read("deploy/scripts/install-github-cli.sh");
    expect(installer).toContain("required_version=2.98.0");
    expect(installer).toContain("3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de");
    expect(installer).toContain("cf689084f3a3618f7eae4a2420d335d74626d65f5e594b9828d125d69f800d86");
  });
});
