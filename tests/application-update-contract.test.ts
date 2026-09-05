import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  chmodSync,
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
  assertSealedControlTree,
  requiredProductionBuildOutputs,
} from "../deploy/scripts/release-assembly.mjs";

const read = (path: string): string => readFileSync(path, "utf8");

describe("Base-only package and local Runtime delivery", () => {
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

  it("publishes only a Base after a local English/Japanese Runtime passes", () => {
    const workflow = read(".github/workflows/renderer-image-daily.yml");
    expect(workflow).toContain("validation_runtime");
    expect(workflow).toContain(
      "collection-langenglish collection-langjapanese",
    );
    expect(workflow).toContain(
      'smoke-test-renderer-en-jp.sh "$validation_runtime"',
    );
    expect(workflow).toContain(
      'smoke-test-renderer-svg.sh "$validation_runtime"',
    );
    expect(workflow).toContain('docker push "$dated_ref"');
    expect(workflow).not.toContain('docker push "$runtime_ref"');
    expect(workflow).not.toContain("validated-runtime-tags");
    expect(workflow).not.toContain("runtime_digests");
    expect(workflow.indexOf("RUNTIME_BUILDX_BUILDER=default")).toBeLessThan(
      workflow.indexOf("sh deploy/scripts/build-language-runtime.sh"),
    );
    expect(read("deploy/scripts/build-language-runtime.sh")).toContain(
      'set -- docker buildx build --builder "$RUNTIME_BUILDX_BUILDER"',
    );
    expect(read("deploy/scripts/smoke-test-renderer-en-jp.sh")).toContain(
      "tests/fixtures/smoke",
    );
  });

  it("keeps dated and latest Base publication behind all Runtime smoke tests", () => {
    const workflow = read(".github/workflows/renderer-image-daily.yml");
    const baseSmoke = workflow.indexOf('smoke-test-texlive-base.sh "$base"');
    const languageSmoke = workflow.indexOf(
      'smoke-test-renderer-en-jp.sh "$validation_runtime"',
    );
    const datedPush = workflow.indexOf('docker push "$dated_ref"');
    const latestPromotion = workflow.indexOf(
      '--tag "$IMAGE_REPOSITORY:latest"',
    );
    expect(languageSmoke).toBeGreaterThan(baseSmoke);
    expect(datedPush).toBeGreaterThan(languageSmoke);
    expect(latestPromotion).toBeGreaterThan(languageSmoke);
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

  it("reuses an exact local Runtime or builds one locally from the verified Base", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    const local = manager.indexOf("Reusing the verified local TeX Runtime");
    const built = manager.indexOf("Building a local TeX Runtime");
    expect(local).toBeGreaterThan(0);
    expect(built).toBeGreaterThan(local);
    expect(manager).not.toContain("Using verified prebuilt TeX Runtime");
    expect(manager).not.toContain("runtimeBuildIfMissing:");
    expect(read("apps/admin-cli/src/index.ts")).not.toContain(
      "--runtime-build-if-missing",
    );
    expect(adminScript).not.toContain("tex-runtime-build-missing");
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
    expect(manager).toContain(
      'const toolingRoot = join(buildSource, ".update-tooling")',
    );
    expect(manager).toContain("NPM_CONFIG_CACHE:");
    expect(manager).toContain('const pnpmBin = join(toolingRoot, "bin")');
    expect(manager).toContain("PNPM_HOME: pnpmBin");
    expect(manager).toContain('"--install-directory", pnpmBin, "pnpm"');
    expect(manager).toContain(
      "PATH: `${pnpmBin}:/usr/local/bin:/usr/bin:/bin`",
    );
    expect(manager).toContain('runCapture(join(pnpmBin, "pnpm"), ["--version"');
    expect(manager).not.toContain('"--global"');
    expect(manager).not.toContain('"--install-directory", "/usr/local/bin"');
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
    expect(helper).toContain(
      'const privilegedStagingRoot = "/opt/latex-renderer/update-staging"',
    );
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
    expect(helper).toContain('case "bootstrap":');
    expect(manager).not.toContain('verb: "bootstrap"');
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
    expect(helper).toContain(
      "Privileged release metadata does not match GitHub",
    );
    expect(assemblyModule).toContain(
      "Build output symlink escapes the release",
    );
    expect(helper).toContain("sealControlTree(assembly, 0)");
    expect(helper).toContain("prepareDeploymentTrees(rootStage, assembly)");
    expect(helper).toContain('["-R", "u=rwX,g=rX,o=", root]');
    expect(helper).toContain("await assertSealedControlTree(root)");
    expect(assemblyModule).toContain(
      "Build output contains a special filesystem entry",
    );
    expect(installHost).toContain("id latex-renderer-update");
    expect(installHost).toContain("/usr/local/bin/corepack --version");
    expect(prepareHost).toContain("id latex-renderer-update");
    expect(manager).toContain("await cleanupStagingRoot()");
    expect(manager).toContain("24 * 60 * 60 * 1000");
    expect(helper).toContain("await copyFile(");
    expect(helper).toContain("deploymentDriver");
    expect(helper).toContain(
      'environment.LATEX_RENDERER_PARENT_MUTATION_LOCK = "application-update"',
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

  it("provides a one-time verified transition from the legacy root updater", () => {
    const helper = read("deploy/scripts/update-manager-helper.mjs");
    const transition = read(
      "deploy/scripts/bootstrap-update-manager-transition.sh",
    );
    expect(helper).toContain("bootstrapPrivilegeSeparatedUpdater");
    expect(helper).toContain(
      "Legacy transition is allowed only while the installed Update Manager still runs as root",
    );
    expect(helper).toContain(
      "Legacy transition requires the explicit root bootstrap launcher",
    );
    expect(helper).toContain(
      'const buildSource = join(rootStage, "bootstrap-build")',
    );
    expect(helper).toContain("assembleBuildArtifacts({");
    expect(helper).toContain(
      "Bootstrap control files do not match the attested immutable release",
    );
    expect(helper).toContain("bootstrapControlFiles");
    expect(helper).toContain(
      'const githubCliCandidates = ["/usr/local/bin/gh", "/usr/bin/gh"]',
    );
    expect(helper).toContain('const pnpmBin = join(toolingRoot, "bin")');
    expect(helper).toContain('"--install-directory", pnpmBin, "pnpm"');
    expect(helper).toContain("PNPM_HOME: pnpmBin");
    expect(helper).toContain('runCapture(join(pnpmBin, "pnpm"), ["--version"');
    expect(helper).toContain(
      '"stop",\n      "latex-renderer-update-manager.service"',
    );
    expect(helper).toContain("await mutationLock?.release()");
    expect(
      helper.indexOf(
        '"start",\n          "latex-renderer-update-manager.service"',
      ),
    ).toBeLessThan(helper.indexOf("await mutationLock?.release()"));
    expect(helper).toContain('if (activeUnitUser !== "latex-renderer-update")');
    expect(transition).toContain("must run through sudo");
    expect(transition).toContain('"verb":"bootstrap"');
    expect(transition).toContain("LATEX_RENDERER_LEGACY_BOOTSTRAP=1");
    expect(transition).toContain(
      "/opt/latex-renderer/update-staging/update-helper.lock",
    );
    expect(transition).not.toContain("deploy-production-release.sh");
  });

  it("verifies public Sigstore bundles without a host GitHub login", () => {
    const helper = read("deploy/scripts/update-manager-helper.mjs");
    const manager = read("deploy/scripts/update-manager.mjs");
    for (const source of [manager, helper]) {
      expect(source).toContain(
        `/attestations/\${encodeURIComponent(release.digest)}`,
      );
      expect(source).toContain('"release-attestations.jsonl"');
      expect(source).toContain('"--bundle"');
      expect(source).toContain("attestationBundle");
      expect(source).toContain('GH_PROMPT_DISABLED: "1"');
      expect(source).not.toContain("GH_TOKEN");
    }
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

  it("seals contained pnpm-style symlinks without trusting writable entries", async () => {
    const root = mkdtempSync(join(tmpdir(), "latex-sealed-tree-test-"));
    const outside = `${root}-outside`;
    const uid = process.getuid?.();
    if (uid === undefined) return;
    try {
      mkdirSync(
        join(root, "packages", "database", "node_modules", "@latex-renderer"),
        {
          recursive: true,
        },
      );
      mkdirSync(join(root, "packages", "shared"), { recursive: true });
      for (const directory of [
        "packages",
        "packages/database",
        "packages/database/node_modules",
        "packages/database/node_modules/@latex-renderer",
        "packages/shared",
      ])
        chmodSync(join(root, directory), 0o755);
      const target = join(root, "packages", "shared", "index.js");
      writeFileSync(target, "export {};\n", { mode: 0o644 });
      symlinkSync(
        "../../../shared",
        join(
          root,
          "packages",
          "database",
          "node_modules",
          "@latex-renderer",
          "shared",
        ),
      );

      await expect(assertSealedControlTree(root, uid)).resolves.toBeUndefined();

      chmodSync(target, 0o664);
      await expect(assertSealedControlTree(root, uid)).rejects.toThrow(
        "group/world-writable",
      );
      chmodSync(target, 0o644);

      symlinkSync(
        "../../../../../../outside",
        join(
          root,
          "packages",
          "database",
          "node_modules",
          "@latex-renderer",
          "escape",
        ),
      );
      await expect(assertSealedControlTree(root, uid)).rejects.toThrow(
        "symlink escapes",
      );
      await expect(assertSealedControlTree(root, uid + 1)).rejects.toThrow(
        "unexpected owner",
      );

      rmSync(
        join(
          root,
          "packages",
          "database",
          "node_modules",
          "@latex-renderer",
          "escape",
        ),
      );
      mkdirSync(outside);
      writeFileSync(join(outside, "payload.js"), "outside\n", { mode: 0o644 });
      symlinkSync(outside, join(root, "packages", "shared", "redirect"));
      symlinkSync(
        "../../../shared/redirect/payload.js",
        join(
          root,
          "packages",
          "database",
          "node_modules",
          "@latex-renderer",
          "chained-escape",
        ),
      );
      await expect(assertSealedControlTree(root, uid)).rejects.toThrow(
        "symlink escapes",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
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
    expect(helper).toContain(
      'const deploymentBuild = join(rootStage, "deployment-build")',
    );
    expect(helper).toContain(
      "LATEX_RENDERER_BUILD_ROOT: deployment.deploymentBuild",
    );
    expect(helper).not.toContain("assertNoSymlinks(buildSource)");
    expect(helper).toContain("await sealControlTree(assembly, identity.gid)");
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
    expect(workflow).toContain("release_kind:");
    expect(workflow).toContain("candidate_tag:");
    expect(workflow).toContain("-rc\\.[1-9][0-9]*$");
    expect(workflow).toContain("verify-release-candidate-promotion.mjs");
    expect(workflow).toContain(".prerelease == true");
    expect(workflow).toContain(".immutable == true");
    expect(workflow).toContain("candidate_digest=$(jq -r");
    expect(workflow).toContain('gh release download "$CANDIDATE_TAG"');
    expect(workflow).toContain('--source-ref "refs/tags/$CANDIDATE_TAG"');
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
      "deploy/scripts/release-version.mjs",
      "deploy/scripts/verify-release-candidate-promotion.mjs",
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
      "deploy/scripts/bootstrap-update-manager-transition.sh",
    ]) {
      const result = spawnSync("sh", ["-n", path], { encoding: "utf8" });
      expect(result.status, `${path}: ${result.stderr}`).toBe(0);
    }
    const launcher = spawnSync(
      "sh",
      ["-n", "deploy/scripts/update-manager-helper-launcher.sh"],
      {
        encoding: "utf8",
      },
    );
    expect(launcher.status, launcher.stderr).toBe(0);
    const ghInstaller = spawnSync(
      "sh",
      ["-n", "deploy/scripts/install-github-cli.sh"],
      {
        encoding: "utf8",
      },
    );
    expect(ghInstaller.status, ghInstaller.stderr).toBe(0);
  });
});

function writeFixture(root: string, relativePath: string, contents: string) {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
