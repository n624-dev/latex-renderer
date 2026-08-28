import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeRuntimeLanguages,
  runtimeIdentity,
} from "../deploy/scripts/runtime-image-identity.mjs";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";

const read = (path: string): string => readFileSync(path, "utf8");

describe("pull-first Runtime delivery", () => {
  it("derives a stable identity from Base, renderer, snapshot, and normalized languages", () => {
    const input = {
      baseImageId: `sha256:${"a".repeat(64)}`,
      rendererFingerprint: "b".repeat(64),
      snapshotDate: "2026-08-27",
    };
    const first = runtimeIdentity({
      ...input,
      languages: ["collection-langjapanese", "collection-langenglish"],
    });
    const second = runtimeIdentity({
      ...input,
      languages: [
        "collection-langenglish",
        "collection-langjapanese",
        "collection-langenglish",
      ],
    });
    expect(first).toEqual(second);
    expect(first.tag).toMatch(/^runtime-v1-2026-08-27-[a-f0-9]{32}$/);
    expect(normalizeRuntimeLanguages(first.languages)).toEqual([
      "collection-langenglish",
      "collection-langjapanese",
    ]);
  });

  it("publishes and anonymously verifies language-neutral and English/Japanese Runtime presets", () => {
    const workflow = read(".github/workflows/renderer-image-daily.yml");
    expect(workflow).toContain("validated-runtime-tags");
    expect(workflow).toContain("runtime_neutral");
    expect(workflow).toContain("runtime_default");
    expect(workflow).toContain('docker push "$runtime_ref"');
    expect(workflow).toContain(
      'docker pull "$IMAGE_REPOSITORY@$runtime_digest"',
    );
    expect(workflow).toContain(
      'smoke-test-renderer-basic.sh "$IMAGE_REPOSITORY@$runtime_digest"',
    );
    expect(workflow).toContain("Verify local Runtime builder");
    expect(workflow).toContain("docker buildx build --builder default --load");
    expect(workflow.indexOf("RUNTIME_BUILDX_BUILDER=default")).toBeLessThan(
      workflow.indexOf("sh deploy/scripts/build-language-runtime.sh"),
    );
    expect(read("deploy/scripts/build-language-runtime.sh")).toContain(
      'set -- docker buildx build --builder "$RUNTIME_BUILDX_BUILDER"',
    );
    const neutralBuild = workflow.indexOf(
      '"$base" "$TEXLIVE_REPOSITORY" "$runtime_neutral"',
    );
    const defaultBuild = workflow.indexOf(
      '"$base" "$TEXLIVE_REPOSITORY" "$runtime_default"',
    );
    const fullSvgSmoke = workflow.indexOf(
      'smoke-test-renderer-svg.sh "$runtime_default"',
    );
    expect(neutralBuild).toBeGreaterThan(0);
    expect(workflow.slice(neutralBuild, defaultBuild)).not.toContain(
      "smoke-test-renderer-svg.sh",
    );
    expect(fullSvgSmoke).toBeGreaterThan(defaultBuild);
  });

  it("checkpoints a validated dated Base while keeping latest behind Runtime publication", () => {
    const workflow = read(".github/workflows/renderer-image-daily.yml");
    const baseSmoke = workflow.indexOf('smoke-test-texlive-base.sh "$base"');
    const checkpoint = workflow.indexOf("base_source=published-checkpoint");
    const runtimePush = workflow.indexOf('docker push "$runtime_ref"');
    const latestPromotion = workflow.indexOf(
      '--tag "$IMAGE_REPOSITORY:latest"',
    );
    expect(checkpoint).toBeGreaterThan(baseSmoke);
    expect(checkpoint).toBeLessThan(runtimePush);
    expect(latestPromotion).toBeGreaterThan(runtimePush);
  });

  it("proves GHCR push scope before starting the expensive image build", () => {
    const workflow = read(".github/workflows/renderer-image-daily.yml");
    const accessWorkflow = read(".github/workflows/ghcr-publish-access.yml");
    const preflight = workflow.indexOf("Verify GHCR package write access");
    const snapshot = workflow.indexOf("Resolve TeX Live snapshot");
    const build = workflow.indexOf("Build and validate");
    expect(preflight).toBeGreaterThan(0);
    expect(preflight).toBeLessThan(snapshot);
    expect(preflight).toBeLessThan(build);
    expect(workflow).toContain(
      'node deploy/scripts/verify-ghcr-write-access.mjs "$IMAGE_REPOSITORY"',
    );
    expect(accessWorkflow).toContain("workflow_dispatch:");
    expect(accessWorkflow).toContain("packages: write");
    expect(accessWorkflow).toContain("verify-ghcr-write-access.mjs");
    expect(accessWorkflow).not.toContain("docker build");
    expect(accessWorkflow).not.toContain("docker push");
  });

  it("uses exact local, public package, and explicit local-build fallback in that order", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    const local = manager.indexOf("Reusing exact local TeX Runtime");
    const pulled = manager.indexOf("Using verified prebuilt TeX Runtime");
    const built = manager.indexOf(
      "building the requested custom TeX Runtime locally",
    );
    expect(local).toBeGreaterThan(0);
    expect(pulled).toBeGreaterThan(local);
    expect(built).toBeGreaterThan(pulled);
    expect(manager).toContain("runtimeBuildIfMissing: false");
    expect(manager).toContain(
      "refusing local build because the pull failure was not proven",
    );
    expect(read("apps/admin-cli/src/index.ts")).toContain(
      "--runtime-build-if-missing <on|off>",
    );
    expect(adminScript).toContain("tex-runtime-build-missing");
  });
});

describe("release-based application updates", () => {
  it("keeps privileged update inputs fixed and verifies immutable release metadata", () => {
    const manager = read("deploy/scripts/update-manager.mjs");
    expect(manager).toContain('repository !== "n624-dev/latex-renderer"');
    expect(manager).toContain("release?.immutable !== true");
    expect(manager).toContain("asset.digest");
    expect(manager).toContain("resolveTagCommit(tag)");
    expect(manager).toContain("manifest?.commit !== release.commit");
    expect(manager).toContain(
      "manifest?.rendererRuntimeFingerprint !== stagedRendererFingerprint",
    );
    expect(manager).toContain("await assertDiskSpace(stateRoot");
    expect(manager).toContain("manifest?.requiredNodeMajor !== 24");
    expect(manager).toContain('pnpm, "self-update", expectedPnpmVersion');
    expect(manager).not.toContain("body.url");
    expect(manager).not.toContain("body.command");
    expect(manager).not.toContain("body.path");
    expect(manager).toContain("Release bundle contains a path outside");
    expect(manager).toContain(
      "Release source bundle must not contain symbolic links",
    );
    expect(manager).toContain(
      "Release bundle may contain only regular files and directories",
    );
    expect(manager).toContain(
      'stateRoot !== "/var/lib/latex-renderer/update-manager"',
    );
    expect(manager).toContain('releaseRoot !== "/opt/latex-renderer/releases"');
    expect(manager).toContain('currentLink !== "/opt/latex-renderer/current"');
    expect(manager).toContain('deployUser === "root"');
  });

  it("uses a root-owned Unix socket helper and leaves sudo out of Web and API", () => {
    const unit = read("deploy/systemd/latex-renderer-update-manager.service");
    const client = read("apps/admin-api/src/services/update-manager.ts");
    expect(unit).toContain("User=root");
    expect(unit).toContain(
      "UPDATE_MANAGER_SOCKET=/run/latex-renderer/update-manager.sock",
    );
    expect(unit).toContain("ProtectSystem=strict");
    expect(client).toContain("socketPath: this.socketPath");
    expect(client).not.toContain("sudo");
    expect(adminScript).not.toContain("sudo ");
  });

  it("serializes application and TeX mutations with one non-blocking OS lock", () => {
    const lock = read("deploy/scripts/mutation-lock.mjs");
    expect(lock).toContain("/run/latex-renderer/mutation.lock");
    expect(lock).toContain('"--nonblock"');
    expect(lock).toContain('"--no-fork"');
    expect(read("deploy/scripts/update-manager.mjs")).toContain(
      "await acquireMutationLock()",
    );
    expect(read("deploy/scripts/image-manager.mjs")).toContain(
      "await acquireMutationLock()",
    );
  });

  it("exposes the same durable operations through Admin API, CLI, Web, and OpenAPI", () => {
    const routes = read("apps/admin-api/src/routes/updates.ts");
    const cli = read("apps/admin-cli/src/index.ts");
    const web = read("apps/admin-web/src/app.ts");
    const openapi = read("openapi/admin.openapi.yaml");
    for (const path of [
      "/updates/state",
      "/updates/check",
      "/updates/policy",
      "/updates/refresh",
      "/updates/apply",
      "/updates/rollback",
      "/updates/operations/",
    ]) {
      expect(cli).toContain(path);
    }
    for (const route of [
      "/state",
      "/check",
      "/policy",
      "/refresh",
      "/apply",
      "/rollback",
      "/operations/:id",
    ]) {
      expect(routes).toContain(route);
    }
    expect(web).toContain('"/admin/updates/": "updates"');
    expect(adminScript).toContain("watchUpdateOperation");
    expect(adminScript).not.toContain("[0-9A-Za-z.-]+)?");
    expect(openapi).toContain("/updates/state:");
    expect(openapi).toContain("/updates/policy:");
    expect(openapi).toContain("/updates/refresh:");
    expect(openapi).toContain("/updates/operations/{id}:");
  });

  it("builds server assets only for protected tags and uploads them to a draft", () => {
    const workflow = read(".github/workflows/server-release.yml");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("contents: write");
    expect(workflow).not.toContain(
      "repos/n624-dev/latex-renderer/immutable-releases",
    );
    expect(workflow).toContain("--verify-tag");
    expect(workflow).toContain("--draft");
    expect(workflow).not.toContain("--draft=false");
    expect(workflow).toContain("latex-renderer-server-$version.tar.gz");
    expect(workflow).toContain("latex-renderer-client-$version.zip");
    expect(workflow).toContain("latex-renderer-local-$version.mcpb");
    expect(workflow).toContain("SHA256SUMS");
    expect(workflow).toContain(".isDraft == true");
    expect(workflow).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+$");
    const builder = read("deploy/scripts/build-server-release-assets.sh");
    expect(builder).toContain('readlink "$admin_web_unit"');
    expect(builder).toContain('find "$stage" -type l');
    expect(builder).toContain(".latex-renderer-release.json");
  });

  it("keeps manager scripts syntactically valid", () => {
    for (const path of [
      "deploy/scripts/update-manager.mjs",
      "deploy/scripts/runtime-image-identity.mjs",
      "deploy/scripts/image-manager.mjs",
    ]) {
      const result = spawnSync(process.execPath, ["--check", path], {
        encoding: "utf8",
      });
      expect(result.status, `${path}: ${result.stderr}`).toBe(0);
    }
    for (const path of [
      "deploy/scripts/build-server-release-assets.sh",
      "deploy/scripts/build-language-runtime.sh",
      "deploy/scripts/restore-managed-runtime.sh",
    ]) {
      const result = spawnSync("sh", ["-n", path], { encoding: "utf8" });
      expect(result.status, `${path}: ${result.stderr}`).toBe(0);
    }
  });
});
