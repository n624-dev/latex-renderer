import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { adminScript } from "../apps/admin-web/src/assets/admin-script.js";

const read = (path: string): string => readFileSync(path, "utf8");

function expectShellSyntax(path: string): void {
  if (process.platform === "win32") return;
  const result = spawnSync("sh", ["-n", path], { encoding: "utf8" });
  expect(result.status, `${path}: ${result.stderr}`).toBe(0);
}

describe("managed TeX Live image pipeline", () => {
  it("keeps public image CI isolated from package publishing and self-hosted runners", () => {
    const workflow = read(".github/workflows/renderer-image.yml");
    const retention = read("deploy/scripts/ghcr-retention.mjs");
    const baseDockerfile = read("renderer/Dockerfile.base");
    const profile = read("deploy/scripts/generate-texlive-profile.sh");
    const baseSmoke = read("deploy/scripts/smoke-test-texlive-base.sh");

    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).not.toContain("self-hosted");
    expect(workflow).not.toContain("packages: write");
    expect(workflow).toContain("push: false");
    expect(workflow).toContain("ci-validate-texlive-base.sh");
    expect(retention).toContain('"--prefer-index=false"');

    expect(baseDockerfile).toContain(
      'jp.n624.latex-renderer.base-kind="texlive-only-v1"',
    );
    expect(baseDockerfile).toContain("ARG DEBIAN_SNAPSHOT=20260812T235959Z");
    expect(baseDockerfile).toContain(
      "snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}",
    );
    expect(baseDockerfile).toContain(
      "TEXLIVE_KEY_FINGERPRINT=C78B82D8C79512F79CC0D7C80D5E5D9106BAB6BC",
    );
    expect(baseDockerfile).toContain(
      "by-fingerprint/${TEXLIVE_KEY_FINGERPRINT}",
    );
    expect(baseDockerfile).toContain("gpgv --keyring /tmp/texlive.gpg");
    expect(baseDockerfile).not.toContain("COPY texmf.cnf latexmkrc compile.sh");
    expect(baseSmoke).toContain("test ! -e /opt/renderer/compile.sh");
    expect(baseSmoke).toContain("kpsewhich pgfplots.sty");
    expect(profile).toContain("name !~ /^collection-lang/");
    expect(profile).toContain("selected_scheme scheme-custom");
  });

  it("publishes daily images transparently from a separate hosted-only workflow", () => {
    const workflow = read(".github/workflows/renderer-image-daily.yml");
    expect(workflow).toContain("schedule:");
    expect(workflow).toContain("runs-on: ubuntu-24.04");
    expect(workflow).not.toContain("self-hosted");
    expect(workflow).toContain("packages: write");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toContain("source_ref");
    expect(read("deploy/scripts/ci-validate-texlive-base.sh")).toContain(
      "smoke-test-texlive-base.sh",
    );
    expect(read("deploy/scripts/ci-validate-texlive-base.sh")).toContain(
      "smoke-test-renderer-basic.sh",
    );
    expect(read("deploy/scripts/ci-validate-texlive-base.sh")).toContain(
      "smoke-test-renderer-en-jp.sh",
    );
    expect(read("deploy/scripts/ci-validate-texlive-base.sh")).toContain(
      "smoke-test-renderer-svg.sh",
    );
    expect(read("deploy/scripts/ci-validate-texlive-base.sh")).toContain(
      "collection-langenglish collection-langjapanese",
    );
    expect(workflow).toContain('docker push "$dated_ref"');
    expect(workflow).not.toContain('docker push "$runtime_ref"');
    expect(workflow).toContain("Verify anonymous pull");
  });

  it("pins every derived runtime to a clean base and validates languages in that exact snapshot", () => {
    const builder = read("deploy/scripts/build-language-runtime.sh");
    const manager = read("deploy/scripts/image-manager.mjs");
    const legacyDockerfile = read("renderer/Dockerfile");

    expect(builder).toContain("base_image_id=$(docker image inspect");
    expect(builder).toContain("base_repo_digest=$(docker image inspect");
    expect(builder).toContain("*@sha256:[0-9a-f][0-9a-f]*)");
    expect(builder).toContain("BASE_IMAGE=$base_lock_ref");
    expect(builder).toContain("base-lock-");
    expect(builder).toContain("RENDERER_RUNTIME_SOURCE");
    expect(builder).toContain("COPY runtime/ /opt/renderer/");
    expect(builder).toContain("jp.n624.latex-renderer.base-image-id");
    expect(builder).toContain(
      "jp.n624.latex-renderer.renderer-runtime-fingerprint",
    );
    expect(builder).toContain('printf \'%s %s\\n\' "$file" "$digest"');
    expect(builder).toContain("*[!A-Za-z0-9._-]*");
    expect(builder).toContain(
      'tlmgr info --repository "${TEXLIVE_REPOSITORY}" --data name "$language"',
    );
    expect(builder).toContain("| sed 's/^name: //' \\");
    expect(builder).toContain('| grep -qx "$language"');
    expect(builder).not.toContain('| grep -qx "name: $language"');
    expect(builder).toContain(
      "Selected TeX Live language collection is unavailable in this snapshot",
    );
    expect(builder).toContain("Docker clears a base image CMD");
    expect(builder).toContain('ENTRYPOINT ["/opt/renderer/compile.sh"]');
    expect(builder).not.toContain("CMD []");
    expect(manager).not.toContain("if (languages.length === 0) return");
    expect(manager).toContain(
      "Derived runtime is missing the current renderer runtime fingerprint",
    );
    expect(manager).toContain(
      "Selected language collections were not installed",
    );
    expect(manager).toContain('baseKind !== "texlive-only-v1"');
    expect(manager).toContain("base.ref,");
    expect(manager).toMatch(
      /["']--file["'],\s*join\(context,\s*["']Dockerfile\.base["']\)/,
    );
    expect(legacyDockerfile).toContain("ARG DEBIAN_SNAPSHOT=20260812T235959Z");
    expect(legacyDockerfile).toContain("gpgv --keyring /tmp/texlive.gpg");
    expect(legacyDockerfile).toContain(
      'if [ "${TEXLIVE_PROFILE_KIND}" = "language-neutral-maximal" ]',
    );
    expect(legacyDockerfile).toContain("rm -f /opt/renderer/compile.sh");
  });

  it("requires a language-neutral PDF/SVG/seccomp smoke test before managed activation", () => {
    const smoke = read("deploy/scripts/smoke-test-renderer-basic.sh");
    const manager = read("deploy/scripts/image-manager.mjs");
    expect(smoke).toContain("LATEX_OUTPUTS=pdf,svg");
    expect(smoke).toContain("MAX_SVG_OBJECTS=50");
    expect(smoke).toContain('kind === "math"');
    expect(smoke).toContain('kind === "tikz"');
    expect(smoke).toContain("seccomp.json");
    expect(manager).toContain("smoke-test-renderer-basic.sh");
  });

  it("keeps desired languages separate from TeX Live dependency collections", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    const restore = read("deploy/scripts/restore-managed-runtime.sh");
    expect(manager).toContain(
      "effectiveLanguageCollections: runtime.effectiveLanguages",
    );
    expect(manager).toContain("const missing = languages.filter");
    expect(manager).not.toContain("installed.length !== languages.length");
    expect(restore).toContain("effectiveLanguageCollections");
    expect(restore).toContain("effective_languages=$(rootless_docker run");
    expect(manager).toContain(
      "desired: {\n      ...previousState.desired,\n      selector,\n      languages,\n      autoUpdate,",
    );
    expect(manager).not.toContain(
      "state.desired = { ...state.desired, selector, languages, autoUpdate }",
    );
    expect(manager).toContain("GHCR Base is not publicly readable");
  });

  it("keeps image activation crash-recoverable and cleanup ID-safe", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    expect(manager).toContain("await seedCurrentRuntimeIfNeeded()");
    expect(manager).toContain("activation-journal.json");
    expect(manager).toContain("async function recoverPendingActivation");
    expect(manager).toContain("async function activateAndPersistState");
    expect(manager).toMatch(/await writeAtomic\(\s*activationJournalPath/);
    expect(manager).toContain("await restoreActivation(snapshot)");
    expect(manager).toContain(
      '"image", "ls", "--all", "--no-trunc", "--quiet"',
    );
    expect(manager).toContain("protectedIds.has(id)");
    expect(manager).toContain(
      "jp.n624.latex-renderer.renderer-runtime-fingerprint",
    );
    expect(manager).toContain("jp.n624.latex-renderer.base-kind");
    expect(manager).toContain('"image", "rm", "--force", id');
    expect(manager).toContain("operationMetaPath");
    expect(manager).toContain(
      "Image manager restarted while this operation was running",
    );
    expect(manager).toContain("deploy/scripts/build-language-runtime.sh");
    expect(manager).toMatch(
      /"builder",\s*"prune",\s*"--force",\s*"--filter",\s*"until=168h"/,
    );
    expect(manager).not.toContain("tlmgr remove");
  });

  it("restores managed state before every renderer-image consumer and uses a shared writable temp root", () => {
    const restore = read("deploy/scripts/restore-managed-runtime.sh");
    const manager = read("deploy/scripts/image-manager.mjs");
    const managerUnit = read(
      "deploy/systemd/latex-renderer-image-manager.service",
    );
    const workerUnit = read("deploy/systemd/latex-renderer-worker.service");
    const internalUnit = read(
      "deploy/systemd/latex-renderer-internal-api.service",
    );
    const remoteUnit = read("deploy/systemd/latex-renderer-remote-mcp.service");
    const cleanupUnit = read(
      "deploy/systemd/latex-renderer-image-log-cleanup.service",
    );
    const cleanupTimer = read(
      "deploy/systemd/latex-renderer-image-log-cleanup.timer",
    );
    const deploy = read("deploy/scripts/deploy-production-release.sh");
    const prune = read("deploy/scripts/prune-production-artifacts.sh");
    const installHost = read("deploy/scripts/install-host.sh");
    const prepare = read("deploy/scripts/prepare-host.sh");

    expect(restore).toContain("current.legacy === true");
    expect(restore).toContain(
      "Refusing to fall back silently to the legacy renderer image",
    );
    expect(restore).toContain(
      "Managed Runtime refresh: reusing the exact locally built Runtime",
    );
    expect(restore).toContain(
      "Managed Runtime refresh: building the selected language Runtime locally from the verified Base",
    );
    expect(restore).toContain('[ "$image_runtime_kind" != managed-local-v1 ]');
    expect(restore).toContain('[ "$local_identity" = "$runtime_identity" ]');
    expect(restore).toContain('[ "$reuse_local" = true ]');
    expect(restore).not.toContain("matching public Runtime");
    expect(restore).toContain(
      "tmp_root=${TMPDIR:-/var/lib/latex-renderer/image-manager/tmp}",
    );
    expect(restore).toContain(
      'mktemp -d "$tmp_root/managed-environment.XXXXXX"',
    );
    expect(restore).not.toContain(
      "mktemp -d /tmp/latex-renderer-managed-environment",
    );
    expect(restore).toContain("RENDERER_RUNTIME_SOURCE");
    expect(restore).toContain("smoke-test-renderer-basic.sh");
    expect(restore).toContain("rendererRuntimeFingerprint");
    expect(restore).toContain("RENDERER_IMAGE=");
    expect(restore).toContain("packages.txt");
    expect(restore).toContain("fonts.txt");
    expect(manager).toContain("effectiveLanguageCollections");
    expect(prepare).toContain("migrate-legacy-languages");
    expect(managerUnit).toContain(
      "ExecStartPre=/bin/sh deploy/scripts/restore-managed-runtime.sh",
    );
    expect(managerUnit).toContain(
      "Environment=TMPDIR=/var/lib/latex-renderer/image-manager/tmp",
    );
    expect(managerUnit).toContain(
      "Environment=DOCKER_CONFIG=/var/lib/latex-renderer/image-manager/docker-config",
    );
    expect(managerUnit).toContain("Before=latex-renderer-worker.service");
    for (const unit of [workerUnit, internalUnit, remoteUnit]) {
      expect(unit).toContain("Requires=latex-renderer-image-manager.service");
      expect(unit).toContain(
        "After=network-online.target latex-renderer-image-manager.service",
      );
    }
    expect(workerUnit).toContain("TimeoutStopSec=15min");
    expect(cleanupUnit).toContain("-mtime +30 -delete");
    expect(cleanupUnit).toContain("-mtime +1 -delete");
    expect(cleanupTimer).toContain("OnCalendar=daily");
    expect(cleanupTimer).toContain("Persistent=true");
    expect(deploy).toContain(
      'sh "$source_root/deploy/scripts/quiesce-image-manager.sh"',
    );
    expect(deploy).toContain("systemctl restart latex-renderer-image-manager");
    expect(deploy).toContain("latex-renderer-image-operation-watchdog.timer");
    expect(prune).toContain(
      "managed TeX runtime or rollback image is protected",
    );
    expect(prune).toContain(
      "managed runtime state does not match RENDERER_IMAGE",
    );
    expect(prune).toContain("previousManaged?.runtimeImageId");
    expect(prune).toContain("previousManaged?.baseImageId");
    expect(installHost).toContain("latex-renderer-image-manager.conf");
    expect(installHost).toContain("operations - - - 30d");
  });

  it("uses a localhost-only privileged helper and refuses registry-failure cold rebuilds", () => {
    const managerUnit = read(
      "deploy/systemd/latex-renderer-image-manager.service",
    );
    const managerLauncher = read("deploy/scripts/start-image-manager.sh");
    const managerClient = read("apps/admin-api/src/services/image-manager.ts");
    const adminUnit = read("deploy/systemd/latex-renderer-admin-api.service");
    const adminTypes = read("apps/admin-api/src/types.ts");
    const installHost = read("deploy/scripts/install-host.sh");
    expect(managerUnit).toContain("Environment=IMAGE_MANAGER_HOST=127.0.0.1");
    expect(managerUnit).toContain("LoadCredential=image-manager-token:");
    expect(managerUnit).toContain(
      "ReadWritePaths=/etc/latex-renderer /var/lib/latex-renderer",
    );
    expect(managerUnit).not.toContain("ReadWritePaths=/run/user");
    expect(managerLauncher).toContain(
      "IMAGE_MANAGER_HOST must be a loopback address",
    );
    expect(managerClient).toContain(
      "IMAGE_MANAGER_URL must be an unauthenticated loopback HTTP URL",
    );
    expect(managerClient).toContain("IMAGE_REGISTRY_UNAVAILABLE");
    expect(managerClient).toContain(
      "images.daily.includes(value.selector.value)",
    );
    expect(managerClient).toContain(
      "refusing to start a cold rebuild for a transient registry failure",
    );
    expect(adminUnit).toContain("LoadCredential=image-manager-token:");
    expect(adminTypes).toContain("imageManager?: ImageManagerClient");
    expect(adminTypes).not.toContain("docker.sock");
    expect(installHost).toContain("xz-utils");
  });

  it("loads derived runtime images into the active Docker image store", () => {
    const runtimeBuild = read("deploy/scripts/build-language-runtime.sh");
    expect(runtimeBuild).toContain('"$@" \\\n  --load \\');
  });

  it("keeps changed shell and Node scripts syntactically valid", () => {
    for (const path of [
      "deploy/scripts/build-language-runtime.sh",
      "deploy/scripts/generate-texlive-profile.sh",
      "deploy/scripts/prepare-host.sh",
      "deploy/scripts/prune-production-artifacts.sh",
      "deploy/scripts/quiesce-image-manager.sh",
      "deploy/scripts/resolve-texlive-snapshot.sh",
      "deploy/scripts/restore-managed-runtime.sh",
      "deploy/scripts/smoke-test-renderer-basic.sh",
      "deploy/scripts/smoke-test-renderer-en-jp.sh",
      "deploy/scripts/smoke-test-texlive-base.sh",
      "deploy/scripts/start-image-manager.sh",
      "deploy/scripts/wait-image-manager-http.sh",
    ])
      expectShellSyntax(path);
    for (const path of [
      "deploy/scripts/image-manager.mjs",
      "deploy/scripts/run-image-refresh.mjs",
      "deploy/scripts/watch-image-manager-operation.mjs",
    ]) {
      const result = spawnSync(process.execPath, ["--check", path], {
        encoding: "utf8",
      });
      expect(result.status, `${path}: ${result.stderr}`).toBe(0);
    }
  });
});

describe("Web and CLI TeX environment parity", () => {
  it("exposes the same management operations through the common Admin API", () => {
    const cli = read("apps/admin-cli/src/index.ts");
    const routes = read("apps/admin-api/src/routes/tex-environment.ts");
    const openapi = read("openapi/admin.openapi.yaml");
    for (const path of [
      "/tex-environment/state",
      "/tex-environment/images",
      "/tex-environment/languages",
      "/tex-environment/country",
      "/tex-environment/apply",
      "/tex-environment/operations/",
      "/tex-environment/rollback",
      "/tex-environment/revalidate",
      "/tex-environment/cleanup",
      "/tex-environment/refresh",
      "/tex-environment/inventory/packages",
      "/tex-environment/inventory/fonts",
    ])
      expect(cli).toContain(path);
    for (const path of [
      "/tex-environment/state:",
      "/tex-environment/images:",
      "/tex-environment/languages:",
      "/tex-environment/country:",
      "/tex-environment/apply:",
      "/tex-environment/operations/{id}:",
      "/tex-environment/inventory/{kind}:",
      "/tex-environment/rollback:",
      "/tex-environment/revalidate:",
      "/tex-environment/cleanup:",
      "/tex-environment/refresh:",
    ])
      expect(openapi).toContain(path);
    expect(routes).toContain('r.get("/state"');
    expect(routes).toContain('r.post("/apply"');
    expect(routes).toContain("r.post(`/${action}`");
    expect(routes).not.toContain("Unknown TeX Live language collection");
    expect(routes).toContain(
      "The exact selected TeX Live snapshot is authoritative",
    );
    expect(routes).toContain("tex_environment.apply_requested");
    expect(routes).toContain("tex_environment.country_updated");
    expect(routes).toContain("tex_environment.${action}_requested");
  });

  it("provides the same language search and explicit select-all/clear-all behavior", () => {
    const cli = read("apps/admin-cli/src/index.ts");
    expect(cli).toMatch(/\.option\(\s*"--search <query>"/);
    expect(cli).not.toContain("--country <country>");
    expect(cli).not.toContain('.option("--selected"');
    expect(cli).toMatch(/\.option\(\s*"--all-languages"/);
    expect(cli).toMatch(/\.option\(\s*"--clear-languages"/);
    expect(cli).toContain(
      "Choose exactly one of --language, --all-languages, or --clear-languages",
    );
    expect(cli).toContain("TEX_LANGUAGE_CATALOG_UNAVAILABLE");
    expect(adminScript).toContain("tex-language-search");
    expect(adminScript).toContain("tex-select-all");
    expect(adminScript).toContain("tex-clear-all");
    expect(adminScript).toContain("if(languages.catalogUnavailable)return");
  });

  it("starts new installs with no language selected and uses only common country detection or persisted override", () => {
    const manager = read("deploy/scripts/image-manager.mjs");
    const routes = read("apps/admin-api/src/routes/tex-environment.ts");
    const openapi = read("openapi/admin.openapi.yaml");
    expect(manager).toContain("languages: []");
    expect(manager).toContain("countryOverride: null");
    expect(manager).toContain("legacyMigrationMarker");
    expect(routes).toContain('c.req.header("CF-IPCountry")');
    expect(routes).not.toContain('c.req.query("country")');
    expect(routes).toContain('"collection-langjapanese"');
    expect(routes).toContain("recommended: rank.has(item.id)");
    expect(routes).toContain(
      "selected: state.desired?.languages?.includes(item.id) ?? false",
    );
    expect(openapi).not.toContain("name: country\n          schema:");
  });

  it("shows desired/effective language state and retains operation logs in both clients", () => {
    const cli = read("apps/admin-cli/src/index.ts");
    expect(cli).toContain("waitTexOperation");
    expect(cli).toContain("reconnecting to Admin API");
    expect(cli).toMatch(/tex\s*\.command\("operation"\)/);
    expect(adminScript).toContain("effectiveLanguageCollections");
    expect(adminScript).toContain("依存言語collection");
    expect(adminScript).toContain("watchTexOperation");
    expect(adminScript).toContain("Admin APIへ再接続中");
    expect(adminScript).toContain("詳細ログを表示");
    expect(adminScript).toContain(
      "state.activeOperationId||state.lastOperationId",
    );
    expect(adminScript).toContain("card.dataset.operationId!==operation.id");
    expect(adminScript).toContain("if(pre.textContent!==nextLog)");
    expect(adminScript).toContain(
      "followTail?pre.scrollHeight:previousScrollTop",
    );
    expect(adminScript).toContain("現在のRuntimeは変更されていません");
  });
});
