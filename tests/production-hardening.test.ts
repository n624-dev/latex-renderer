import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("production hardening", () => {
  it("allows a full 300 seconds for LaTeX compilation", () => {
    expect(read("renderer/compile.sh")).toContain(
      "timeout -s TERM -k 2 300 latexmk",
    );
  });
  it("keeps the worker deadline above the compiler deadline", () => {
    expect(read(".env.example")).toContain("RENDERER_JOB_TIMEOUT_SECONDS=420");
    expect(read("deploy/scripts/prepare-host.sh")).toContain(
      "RENDERER_JOB_TIMEOUT_SECONDS=420",
    );
  });
  it("stores backups below the traversable application state directory", () => {
    for (const path of [
      "deploy/scripts/install-host.sh",
      "deploy/scripts/prepare-host.sh",
      "deploy/systemd/latex-renderer-backup.service",
      "deploy/systemd/latex-renderer-audit-export.service",
    ])
      expect(read(path)).toContain("/var/lib/latex-renderer/backups");
  });
  it("does not enable unsupported AppArmor in the rootless production environment", () => {
    expect(read(".env.example")).not.toMatch(/^RENDERER_APPARMOR_PROFILE=/m);
    expect(read("deploy/scripts/prepare-host.sh")).toContain(
      "sed -i '/^RENDERER_APPARMOR_PROFILE=/d'",
    );
  });
  it("uses canonical cross-platform client download routes during deployment", () => {
    const script = read("deploy/scripts/deploy-production-release.sh");
    expect(script).toContain("/downloads/client");
    expect(script).toContain("/downloads/windows/install.ps1");
    expect(script).not.toContain("latex.example.com/client/manifest.json");
  });
  it("checks stable content on both unified local Web surfaces", () => {
    const script = read("deploy/scripts/deploy-production-release.sh");
    expect(script).toContain("LaTeXをPDFに変換");
    expect(script).toContain('data-page="dashboard"');
    expect(script).toContain("レンダリング処理：応答中");
    expect(script).not.toContain("grep -q 'クライアント登録'");
  });
  it("uses host-local Tunnel credentials and reconciles remote routes without restarting the connector", () => {
    const prepare = read("deploy/scripts/prepare-host.sh"),
      deploy = read("deploy/scripts/deploy-production-release.sh"),
      sync = read("deploy/scripts/sync-cloudflare-tunnel-config.mjs");
    expect(read("deploy/cloudflared/config.example.yml")).toContain(
      "REPLACE_WITH_TUNNEL_ID",
    );
    expect(prepare).toContain("CLOUDFLARED_CONFIG_FILE");
    expect(prepare).not.toContain("source_owner_home");
    expect(sync).toContain('before.source !== "cloudflare"');
    expect(deploy).toContain("sync-cloudflare-tunnel-config.mjs");
    expect(deploy).not.toContain("systemctl restart cloudflared");
    expect(deploy).toContain("systemctl is-active --quiet cloudflared");
  });
  it("retrieves Wrangler credentials through the deployment user's pinned pnpm", () => {
    const script = read("deploy/scripts/sync-cloudflare-tunnel-config.mjs");
    expect(script).toMatch(/execFileSync\(\s*"pnpm",\s*\["exec", "wrangler"/);
    expect(script).not.toContain('execFileSync("corepack"');
  });
  it("deploys the production Gateway explicitly and smoke-tests its health route with each release", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh"),
      smoke = read("deploy/scripts/smoke-test-unified-origin.sh");
    expect(deploy).toContain("@latex-renderer/gateway-worker run deploy");
    expect(smoke).toContain("/api/v1/health");
  });
  it("exercises secret-free structured CLI output in the production render smoke test", () => {
    const smoke = read("deploy/scripts/smoke-test-production.sh");
    expect(smoke).toContain('render "$temporary_root/project" --json');
    expect(smoke).toContain('value.command!=="render"');
    expect(smoke).toContain("/apiKey|uploadTicket|jobTicket/i");
  });
  it("exercises the published cross-platform setup lifecycle in an isolated temporary root", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh");
    expect(deploy).toContain("client-install.mjs");
    expect(deploy).toContain("--skill-target none");
    expect(deploy).toContain("--mcp-target none");
    expect(deploy).toContain('latex-render" doctor --json');
    expect(deploy).toContain('value.command!=="setup.remove"');
    expect(deploy).toContain("/apiKey|uploadTicket|jobTicket|lrk_/i");
  });
  it("proves the VPC-bound Gateway before removing configured legacy routes", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh"),
      gateway = read("apps/gateway-worker/wrangler.example.jsonc"),
      tunnel = read("deploy/scripts/sync-cloudflare-tunnel-config.mjs"),
      smoke = read("deploy/scripts/smoke-test-production.sh"),
      prepare = 'deploy/scripts/prepare-host.sh" "$release_id',
      gatewayDeploy = "gateway-worker run deploy",
      renderSmoke = "smoke-test-production.sh",
      removeLegacy = "sync-cloudflare-tunnel-config.mjs";
    expect(gateway).toContain('"binding": "INTERNAL_API"');
    expect(gateway).toContain("00000000-0000-0000-0000-000000000000");
    expect(tunnel).toContain("CLOUDFLARE_LEGACY_HOSTNAMES");
    expect(tunnel).not.toContain("n624.jp");
    expect(deploy.indexOf(prepare)).toBeLessThan(deploy.indexOf(gatewayDeploy));
    expect(deploy.indexOf(gatewayDeploy)).toBeLessThan(
      deploy.indexOf(renderSmoke),
    );
    expect(deploy.indexOf(renderSmoke)).toBeLessThan(
      deploy.lastIndexOf(removeLegacy),
    );
    expect(smoke).toContain("PUBLIC_ORIGIN");
    expect(smoke).not.toContain("latex.example.com");
    expect(smoke).not.toContain("LATEX_RENDER_GATEWAY_URL");
  });
  it("keeps the VPC Internal API loopback-only without legacy Access configuration", () => {
    const server = read("apps/internal-api/src/server.ts"),
      app = read("apps/internal-api/src/app.ts"),
      configure = read("deploy/scripts/configure-host-access.sh");
    expect(server).toContain('hostname: "127.0.0.1"');
    expect(server).not.toContain("CLOUDFLARE_INTERNAL_");
    expect(app).not.toContain("Cf-Access-Jwt-Assertion");
    expect(configure).toContain("/^CLOUDFLARE_INTERNAL_AUDIENCE=/d");
  });
  it("invokes the public Web deploy package script with the deployment user's pnpm on PATH", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh");
    expect(deploy).toContain("--filter @latex-renderer/public-web run deploy");
    expect(deploy).toContain(
      'sync_pnpm_bin="$sync_home/.local/share/pnpm/bin"',
    );
    expect(deploy).toContain('PNPM_HOME="$sync_pnpm_bin" PATH="$sync_path"');
    expect(deploy).toContain('if [ ! -x "$sync_pnpm_bin/pnpm" ]');
    expect(deploy).toContain('"$sync_pnpm_bin/pnpm" --dir "$source_root"');
    expect(deploy).not.toContain("/usr/local/bin/corepack pnpm");
  });
  it("builds production service artifacts before copying the immutable release", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh"),
      root = JSON.parse(read("package.json")) as {
        scripts: Record<string, string>;
      },
      build = "build:production-services",
      prepare = 'prepare-host.sh" "$release_id';
    expect(root.scripts[build]).toContain("@latex-renderer/remote-mcp...");
    expect(root.scripts[build]).toContain("@latex-renderer/renderer-api...");
    expect(deploy).toContain(build);
    expect(deploy.indexOf(build)).toBeLessThan(deploy.indexOf(prepare));
  });
  it("enables Remote MCP so it returns after a production host reboot", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh");
    expect(deploy).toMatch(
      /systemctl enable --now \\\n\s+latex-renderer-remote-mcp\.service/,
    );
  });
  it("clears inherited setgid bits before rootless Docker reads temporary build trees", () => {
    for (const path of [
      "deploy/scripts/build-language-runtime.sh",
      "deploy/scripts/smoke-test-renderer-basic.sh",
      "deploy/scripts/smoke-test-renderer-svg.sh",
    ]) {
      expect(read(path)).toContain('chmod 00755 "$');
      expect(read(path)).not.toContain('chmod 0755 "$');
    }
    expect(
      read("deploy/systemd/latex-renderer-image-manager.service"),
    ).toContain("RestrictSUIDSGID=true");
  });
  it("allows public Worker Routes to converge before judging the production boundary", () => {
    const smoke = read("deploy/scripts/smoke-test-public-worker-boundary.sh");
    expect(smoke).toContain("LATEX_RENDER_BOUNDARY_ATTEMPTS");
    expect(smoke).toContain('sleep "$boundary_retry_delay"');
    expect(smoke).toContain("assert_worker legacy-client");
  });
  it("separates Cloudflare Access redirects from local OAuth Origin validation", () => {
    const smoke = read("deploy/scripts/smoke-test-public-worker-boundary.sh");
    expect(smoke).toContain("LATEX_RENDER_REMOTE_MCP_LOCAL_ORIGIN");
    expect(smoke).toContain("302|403)");
    expect(smoke).toContain('"$remote_mcp_local_origin/oauth/authorize"');
    expect(smoke).toContain("Authorization confirmation expired");
    expect(smoke).toContain("Origin is not allowed");
  });
  it("waits for the published client manifest and archive to converge to the local release", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh"),
      verify = read("deploy/scripts/verify-public-client-assets.mjs");
    expect(deploy).toContain("verify-public-client-assets.mjs");
    expect(deploy).toContain(
      "apps/public-web/dist/downloads/client/manifest.json",
    );
    expect(verify).toContain(
      "published manifest does not match the local release manifest",
    );
    expect(verify).toContain("LATEX_RENDER_CLIENT_ASSET_ATTEMPTS");
  });
  it("builds, refreshes, and verifies rootless renderer images from each immutable release", () => {
    const script = read("deploy/scripts/prepare-host.sh"),
      build = 'docker build --tag "$source_image" "$release_root/renderer"',
      inspect = "source_image_id=$(docker image inspect";
    expect(script).toContain(build);
    expect(script.indexOf(build)).toBeLessThan(script.indexOf(inspect));
    expect(script).toContain("renderer-source-image-id");
    expect(script).toContain('installed_source_image_id" != "$source_image_id');
    expect(script).toContain(
      "rootless Docker image runtime fingerprint check failed",
    );
  });
  it("prunes old releases and dangling rootless images only after production verification", () => {
    const deploy = read("deploy/scripts/deploy-production-release.sh"),
      prune = read("deploy/scripts/prune-production-artifacts.sh"),
      smoke = "smoke-test-public-worker-boundary.sh",
      cleanup = "prune-production-artifacts.sh";
    expect(deploy.indexOf(smoke)).toBeLessThan(deploy.indexOf(cleanup));
    expect(prune).toContain("release_retention_count=3");
    expect(prune).toContain('active_release" != "$expected_release');
    expect(prune).toContain('tagged_image" != "$configured_image');
    expect(prune).toContain('docker "$@"');
    expect(prune).toContain("image prune --force");
    expect(prune).not.toContain("system prune");
  });
  it("keeps job trees removable by the cleanup service", () => {
    const prepare = read("deploy/scripts/prepare-host.sh"),
      compile = read("renderer/compile.sh");
    expect(prepare).toContain("-path '*/work*' -exec chmod g+rwx");
    expect(prepare).toContain("-path '*/output*'");
    expect(prepare).toContain("-path '*/staging*'");
    expect(prepare).toContain("-exec chmod a+rwx");
    expect(compile.indexOf("umask 000")).toBeLessThan(
      compile.indexOf("/work/output/previews"),
    );
    expect(compile).toContain("trap ensure_cleanup_access EXIT");
    expect(read("packages/zip-validation/src/index.ts")).toContain(
      "chmod(destination, 0o775)",
    );
    expect(read("apps/renderer-worker/src/job-processor.ts")).toContain(
      "chmod(work, 0o770)",
    );
  });
  it("uses a default-deny seccomp allowlist", () => {
    const profile = JSON.parse(read("deploy/security/seccomp.json")) as {
      defaultAction: string;
      syscalls: Array<{ action: string; names: string[] }>;
    };
    expect(profile.defaultAction).toBe("SCMP_ACT_ERRNO");
    expect(
      profile.syscalls.some(
        (rule) =>
          rule.action === "SCMP_ACT_ALLOW" && rule.names.includes("execve"),
      ),
    ).toBe(true);
  });
  it("pins and verifies TeX Live build inputs", () => {
    const dockerfile = read("renderer/Dockerfile");
    expect(dockerfile).toContain("tlnet-archive/2026/08/12/tlnet");
    expect(dockerfile).toContain("sha512sum --check --strict");
    expect(dockerfile).toContain("gpgv --keyring");
    expect(dockerfile).toContain("build-provenance.json");
    expect(dockerfile).not.toContain(
      "mirror.ctan.org/systems/texlive/tlnet/install-tl-unx",
    );
  });
});
