import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  normalizeRuntimeLanguages,
  runtimeIdentity,
} from "../deploy/scripts/runtime-image-identity.mjs";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";
import {
  assembleBuildArtifacts,
  requiredProductionBuildOutputs,
} from "../deploy/scripts/release-assembly.mjs";

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
    const manager = read("deploy/scripts/update-manager.mjs"),
      helper = read("deploy/scripts/update-manager-helper.mjs"),
      archive = read("deploy/scripts/release-archive.mjs");
    expect(manager).toContain('repository !== "n624-dev/latex-renderer"');
    expect(manager).toContain("release?.immutable !== true");
    expect(manager).toContain("asset.digest");
    expect(manager).toContain("resolveTagCommit(tag)");
    expect(manager).toContain("manifest?.commit !== release.commit");
    expect(manager).toContain(
      "manifest?.rendererRuntimeFingerprint !== stagedRendererFingerprint",
    );
    expect(manager).toMatch(/await assertDiskSpace\(\s*stagingRoot,/);
    expect(manager).toContain("manifest?.requiredNodeMajor !== 24");
    expect(manager).toContain('const corepack = "/usr/local/bin/corepack"');
    expect(manager).toContain("packageManager");
    expect(manager).toContain("!/^pnpm@\\d+\\.\\d+\\.\\d+$/.test");
    expect(manager).toContain('const toolingRoot = join(buildSource, ".update-tooling")');
    expect(manager).toContain("NPM_CONFIG_CACHE:");
    expect(manager).not.toContain('"--global"');
    expect(manager).not.toContain('"--install-directory"');
    expect(manager).not.toContain('pnpm, "self-update"');
    expect(manager).not.toContain("body.url");
    expect(manager).not.toContain("body.command");
    expect(manager).not.toContain("body.path");
    expect(archive).toContain("Release bundle contains a path outside");
    expect(manager).toContain("validateReleaseArchive");
    expect(manager).toContain(
      "Release source bundle must not contain symbolic links",
    );
    expect(archive).toContain(
      "Release bundle may contain only regular files and directories",
    );
    expect(manager).toContain(
      'stateRoot !== "/var/lib/latex-renderer/update-manager"',
    );
    expect(manager).toContain(
      'const stagingRoot = "/var/lib/latex-renderer/update-manager/staging"',
    );
    expect(manager).toContain('releaseRoot !== "/opt/latex-renderer/releases"');
    expect(manager).toContain('currentLink !== "/opt/latex-renderer/current"');
    expect(helper).toContain('const privilegedStagingRoot = "/opt/latex-renderer/update-staging"');
    expect(helper).toContain('deployUser === "root"');
  });

  it("uses a non-root controller and a fixed short-lived root helper", () => {
    const unit = read("deploy/systemd/latex-renderer-update-manager.service");
    const imageManagerUnit = read(
      "deploy/systemd/latex-renderer-image-manager.service",
    );
    const client = read("apps/admin-api/src/services/update-manager.ts");
    const helper = read("deploy/scripts/update-manager-helper.mjs");
    const launcher = read("deploy/scripts/update-manager-helper-launcher.sh");
    const sudoers = read("deploy/sudoers.d/latex-renderer-update");
    const manager = read("deploy/scripts/update-manager.mjs");
    expect(unit).toContain("User=latex-renderer-update");
    expect(unit).toContain(
      "UPDATE_MANAGER_SOCKET=/run/latex-renderer/update-manager.sock",
    );
    expect(unit).toContain("NoNewPrivileges=false");
    expect(unit).toContain("ProtectHome=true");
    expect(unit).toContain("PrivateDevices=true");
    expect(unit).toContain(
      "ReadWritePaths=/var/lib/latex-renderer/update-manager /run/latex-renderer",
    );
    expect(unit).toContain("RuntimeDirectory=latex-renderer");
    expect(unit).toContain("RuntimeDirectoryPreserve=yes");
    expect(imageManagerUnit).toContain("RuntimeDirectory=latex-renderer");
    expect(imageManagerUnit).toContain("RuntimeDirectoryPreserve=yes");
    expect(client).toContain("socketPath: this.socketPath");
    expect(client).not.toContain("sudo");
    expect(adminScript).not.toContain("sudo ");
    expect(manager).toContain("Update Manager controller must not run as root");
    expect(manager).toContain(
      'const privilegedHelper = "/usr/local/libexec/latex-renderer-update-helper"',
    );
    expect(manager).toContain('"/usr/bin/sudo"');
    expect(manager).not.toContain('"systemd-run"');
    expect(helper).toContain("Update helper must run as root");
    expect(helper).toContain('case "apply":');
    expect(helper).toContain('case "rollback":');
    expect(helper).toContain('case "schedule-manager-restart":');
    expect(helper).not.toContain("request.command");
    expect(helper).not.toContain("request.path");
    expect(launcher).toContain("does not accept command-line arguments");
    expect(sudoers).toContain(
      "NOPASSWD: NOSETENV: /usr/local/libexec/latex-renderer-update-helper",
    );
  });

  it("separates the verified control tree, non-root build tree, and sealed assembly", () => {
    const manager = read("deploy/scripts/update-manager.mjs");
    const assemblyModule = read("deploy/scripts/release-assembly.mjs");
    const installHost = read("deploy/scripts/install-host.sh");
    const prepareHost = read("deploy/scripts/prepare-host.sh");
    const unit = read("deploy/systemd/latex-renderer-update-manager.service");
    const helper = read("deploy/scripts/update-manager-helper.mjs");
    expect(manager).toContain("mkdtemp(join(stagingRoot");
    expect(manager).not.toContain('mkdtemp(join(stateRoot, "staging"');
    expect(manager).toContain(
      'const stagingRoot = "/var/lib/latex-renderer/update-manager/staging"',
    );
    expect(manager).toContain(
      "Update staging root must be owned by the controller",
    );
    expect(manager).not.toContain("chown(stage");
    expect(manager).toContain('const verified = join(stage, "verified")');
    expect(manager).toContain('const buildSource = join(stage, "build")');
    expect(helper).toContain('const assembly = join(rootStage, "assembly")');
    expect(helper).toContain("Privileged release metadata does not match GitHub");
    expect(assemblyModule).toContain(
      "Build output symlink escapes the release",
    );
    expect(helper).toContain('["-R", "root:root", assembly]');
    expect(helper).toContain("prepareDeploymentTrees(rootStage, assembly)");
    expect(helper).toContain('["-R", "u=rwX,g=rX,o=", assembly]');
    expect(helper).toContain('"-perm",\n      "/022"');
    expect(assemblyModule).toContain(
      "Build output contains a special filesystem entry",
    );
    expect(installHost).toContain(
      "id latex-renderer-update",
    );
    expect(installHost).toContain("/usr/local/bin/corepack --version");
    expect(prepareHost).toContain(
      "id latex-renderer-update",
    );
    expect(manager).toContain("await cleanupStagingRoot()");
    expect(manager).toContain("24 * 60 * 60 * 1000");
    expect(helper).toContain("await copyFile(");
    expect(helper).toContain("deploymentDriver");
    expect(helper).toContain(
      'LATEX_RENDERER_PARENT_MUTATION_LOCK: "application-update"',
    );
    expect(prepareHost).toContain(
      "chmod 0700 /var/lib/latex-renderer/update-manager/staging",
    );
    expect(prepareHost).toContain('chmod o-rwx "$previous_release"');
    expect(unit).toContain(
      "ReadWritePaths=/var/lib/latex-renderer/update-manager /run/latex-renderer",
    );
    expect(unit).toContain("NoNewPrivileges=false");
    expect(unit).toContain("ProtectHome=true");
    expect(unit).toContain("PrivateDevices=true");
    expect(unit).toContain("ProtectKernelTunables=true");
    expect(unit).toContain("ProtectKernelModules=true");
    expect(unit).toContain("ProtectControlGroups=true");
    expect(installHost).not.toContain("usermod -aG latex-renderer");
    expect(prepareHost).not.toContain("usermod -aG latex-renderer");
    expect(read("deploy/scripts/deploy-production-release.sh")).toContain(
      "Application Update Manager must use a separate non-root build tree",
    );
  });

  it("never overlays build-user changes to root-executed control scripts", async () => {
    const root = mkdtempSync(join(tmpdir(), "latex-release-assembly-test-"));
    try {
      const verifiedSource = join(root, "verified");
      const buildSource = join(root, "build");
      const assembly = join(root, "assembly");
      for (const directory of [verifiedSource, buildSource, assembly])
        mkdirSync(directory, { recursive: true });
      const controlPath = "deploy/scripts/prepare-host.sh";
      writeFixture(verifiedSource, controlPath, "trusted-control\n");
      writeFixture(buildSource, controlPath, "build-user-payload\n");
      const firstOutput = requiredProductionBuildOutputs[0];
      if (!firstOutput) throw new Error("production output allowlist is empty");
      for (const output of requiredProductionBuildOutputs)
        writeFixture(buildSource, output, `built:${output}\n`);

      await assembleBuildArtifacts({
        verifiedSource,
        buildSource,
        assembly,
        runCommand(command, args) {
          const result = spawnSync(command, args, { encoding: "utf8" });
          if (result.status !== 0)
            throw new Error(result.stderr || `${command} failed`);
        },
      });

      expect(read(join(assembly, controlPath))).toBe("trusted-control\n");
      expect(read(join(assembly, firstOutput))).toBe(`built:${firstOutput}\n`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("runs deployment-user commands from the private stage instead of the protected service cwd", () => {
    const manager = read("deploy/scripts/update-manager.mjs");
    const helper = read("deploy/scripts/update-manager-helper.mjs");
    const deploy = read("deploy/scripts/deploy-production-release.sh");
    expect(manager).toContain("runPrivileged(operation, {");
    expect(manager).toContain('verb: "apply"');
    expect(helper).toContain("function directChild(root, name)");
    expect(helper).toContain("ensureBuildSource");
    expect(helper).toContain("prepareDeploymentTrees");
    expect(helper).toContain('const deploymentBuild = join(rootStage, "deployment-build")');
    expect(helper).toContain(
      "LATEX_RENDERER_BUILD_ROOT: deployment.deploymentBuild",
    );
    expect(helper).not.toContain("assertNoSymlinks(buildSource)");
    expect(helper).toContain('await runLogged("chown", ["-R", `0:${identity.gid}`, assembly])');
    expect(helper).toContain("UPDATE_DEPLOY_USER");
    expect(deploy).toContain("source_root=$(CDPATH= cd --");
    expect(deploy).toContain('cd "$source_root"');
    expect(deploy).toContain('runuser -u "$sync_user"');
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

  it("bounds manager operation logs and backpressures child output", () => {
    for (const path of [
      "deploy/scripts/update-manager.mjs",
      "deploy/scripts/image-manager.mjs",
    ]) {
      const manager = read(path);
      expect(manager).toContain("MAX_OPERATION_LOG_BYTES");
      expect(manager).toContain("[LOG_LIMIT_REACHED]");
      expect(manager).toContain("for await (const chunk of stream)");
      expect(manager).not.toContain("void appendLog(");
    }
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
      "deploy/scripts/update-manager-helper.mjs",
      "deploy/scripts/release-assembly.mjs",
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
      "deploy/scripts/deploy-production-release.sh",
    ]) {
      const result = spawnSync("sh", ["-n", path], { encoding: "utf8" });
      expect(result.status, `${path}: ${result.stderr}`).toBe(0);
    }
    const launcher = spawnSync("sh", ["-n", "deploy/scripts/update-manager-helper-launcher.sh"], {
      encoding: "utf8",
    });
    expect(launcher.status, launcher.stderr).toBe(0);
    const ghInstaller = spawnSync("sh", ["-n", "deploy/scripts/install-github-cli.sh"], {
      encoding: "utf8",
    });
    expect(ghInstaller.status, ghInstaller.stderr).toBe(0);
  });
});

function writeFixture(root: string, relativePath: string, contents: string) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
