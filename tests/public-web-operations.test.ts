import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { activeWorkerVersion } from "../deploy/scripts/read-active-worker-version.mjs";

const read = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("public Web operations", () => {
  it("selects the newest active Worker version regardless of Wrangler list order", () => {
    expect(
      activeWorkerVersion([
        {
          created_on: "2026-08-10T10:05:26Z",
          versions: [{ percentage: 100, version_id: "old" }],
        },
        {
          created_on: "2026-08-10T10:25:36Z",
          versions: [{ percentage: 100, version_id: "current" }],
        },
      ]),
    ).toBe("current");
  });

  it("runs a credential-free local Worker Preview in pull-request validation", () => {
    const workflow = read(".github/workflows/ci.yml");
    const packageJson = read("apps/public-web/package.json");
    const preview = read("apps/public-web/check-preview.mjs");

    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("run: pnpm check");
    expect(workflow).not.toContain("CLOUDFLARE_API_TOKEN");
    expect(workflow).not.toContain("secrets.");
    expect(packageJson).toContain("pnpm check:preview");
    expect(preview).toContain('"wrangler"');
    expect(preview).toContain('"dev", "--local"');
    expect(preview).toContain("Preview redirect contract failed");
  });

  it("validates main and Preview before production mutation", () => {
    const deploy = read("deploy/scripts/deploy-public-web-production.sh");
    const mainGuard = deploy.indexOf('= "main"');
    const repositoryCheck = deploy.indexOf("pnpm check");
    const workerDeploy = deploy.indexOf("run deploy");
    const routeApply = deploy.indexOf("sync-public-worker-routes.mjs --apply");

    expect(mainGuard).toBeGreaterThan(-1);
    expect(deploy).toContain("git status --porcelain");
    expect(deploy).toContain("git rev-parse origin/main");
    expect(mainGuard).toBeLessThan(repositoryCheck);
    expect(repositoryCheck).toBeLessThan(workerDeploy);
    expect(workerDeploy).toBeLessThan(routeApply);
  });

  it("has independent version and VPS rollback paths", () => {
    const deploy = read("deploy/scripts/deploy-public-web-production.sh");
    const boundaryFailure = deploy.indexOf(
      "if ! deploy/scripts/smoke-test-public-worker-boundary.sh",
    );
    const automaticDisable = deploy.indexOf(
      "sync-public-worker-routes.mjs --disable",
      boundaryFailure,
    );

    expect(deploy).toContain("--rollback-version");
    expect(deploy).toContain('wrangler rollback "$version_id"');
    expect(deploy).toContain("--rollback-vps");
    expect(automaticDisable).toBeGreaterThan(boundaryFailure);
    expect(deploy).toContain("smoke-test-unified-origin.sh");
  });

  it("checks Cloudflare and VPS health as separate boundaries", () => {
    const health = read("deploy/scripts/check-public-web-health.sh");
    const documentation = read("DEPLOYMENT.md");

    expect(health).toContain("sync-public-worker-routes.mjs");
    expect(health).toContain("smoke-test-public-worker-boundary.sh");
    expect(health).toContain("smoke-test-unified-origin.sh");
    expect(documentation).toContain("wrangler tail --format=json");
    expect(documentation).toContain("journalctl -u latex-renderer-web");
  });
});
