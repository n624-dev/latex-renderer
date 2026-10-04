import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const scripts = (path: string) =>
  (JSON.parse(read(path)) as { scripts: Record<string, string> }).scripts;

describe("cache-free CI validation", () => {
  it("builds fresh once and retains every pnpm check phase and distribution verification", () => {
    const workflow = read(".github/workflows/ci.yml");
    const commands = [
      "pnpm typecheck",
      "pnpm build:workspaces",
      "pnpm check:docs",
      "pnpm test",
      "pnpm lint",
      "pnpm test:browser:built",
      "pnpm verify:mcpb",
    ];
    let previous = -1;
    for (const command of commands) {
      const index = workflow.indexOf(`-- ${command}\n`);
      expect(index, command).toBeGreaterThan(previous);
      previous = index;
    }
    expect(workflow.match(/-- pnpm build:workspaces\n/g)).toHaveLength(1);
    expect(workflow).not.toContain("run: pnpm build\n");
    expect(workflow).not.toContain(
      "--filter @latex-renderer/gateway-worker build",
    );
    expect(workflow).not.toContain("actions/cache");
    expect(workflow).not.toContain("cache-from:");
    expect(workflow).toContain("--with-deps --only-shell chromium");
    expect(workflow).toContain("cancel-in-progress: true");
    expect(workflow).toContain("Scan repository history for secrets");
  });

  it("recursive build still creates both Worker bundles and signed client assets", () => {
    const root = scripts("package.json");
    expect(root["build:workspaces"]).toBe("pnpm -r build");
    const publicWeb = scripts("apps/public-web/package.json");
    expect(publicWeb.build).toContain("pnpm build:assets");
    expect(publicWeb.build).toContain("wrangler deploy --dry-run");
    expect(publicWeb.build).toContain("pnpm check:preview");
    expect(publicWeb["build:assets"]).toContain(
      "pnpm --dir ../.. build:client",
    );
    expect(root["build:client"]).toContain(
      "node client/build-client.mjs && node client/build-mcpb.mjs",
    );
    expect(scripts("apps/gateway-worker/package.json").build).toContain(
      "--dry-run",
    );
    expect(root["test:browser:built"]).toBe(
      "vitest run --config vitest.browser.config.ts",
    );
    expect(root["test:browser"]).toContain(
      "pnpm --filter @latex-renderer/web build &&",
    );
  });

  it.each(["server-release", "server-update-validation"])(
    "%s checks fresh distributions without regenerating the same signed assets",
    (name) => {
      const workflow = read(`.github/workflows/${name}.yml`);
      expect(scripts("package.json").check).toContain("pnpm build:workspaces");
      expect(workflow.match(/^\s+pnpm check$/gm)).toHaveLength(1);
      expect(workflow).not.toMatch(/^\s+pnpm build:client$/m);
      const check = workflow.indexOf("          pnpm check\n");
      const verify = workflow.indexOf("          pnpm verify:mcpb\n");
      const bundle = workflow.indexOf(
        "          sh deploy/scripts/build-server-release-assets.sh",
      );
      expect(verify).toBeGreaterThan(check);
      expect(bundle).toBeGreaterThan(verify);
      expect(workflow).toContain("--frozen-lockfile");
      expect(workflow).toContain("actions/attest-build-provenance");
      expect(workflow).not.toContain("actions/cache");
    },
  );

  it("disables implicit Trivy Actions caches without skipping scanners", () => {
    for (const path of ["security", "renderer-image"]) {
      const workflow = read(`.github/workflows/${path}.yml`);
      const trivy = workflow.slice(
        workflow.indexOf("uses: aquasecurity/trivy-action"),
      );
      expect(trivy).toMatch(/with:\n\s+cache: false/);
      expect(trivy).toContain("scanners: vuln,misconfig,secret");
      expect(trivy).toContain("severity: HIGH,CRITICAL");
    }
  });

  it("retains daily and manual cache cleanup, not one job per completed workflow", () => {
    const cleanup = read(".github/workflows/actions-cache-cleanup.yml");
    expect(cleanup).toContain("schedule:");
    expect(cleanup).toContain("workflow_dispatch:");
    expect(cleanup).not.toContain("workflow_run:");
    expect(cleanup).toContain("gh cache delete --all --succeed-on-no-caches");
    expect(cleanup).not.toContain("actions/checkout");
    expect(cleanup).not.toContain("gh api");
  });
});
