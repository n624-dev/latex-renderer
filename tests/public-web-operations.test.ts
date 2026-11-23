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
    expect(workflow).toContain("-- pnpm build:workspaces");
    expect(workflow).toContain("-- pnpm typecheck");
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
    const workerUpload = deploy.indexOf("wrangler versions upload");
    const verifyPreview = deploy.indexOf(
      'check-live-content.mjs "$preview_url"',
    );
    const workerDeploy = deploy.indexOf("wrangler versions deploy");
    const routeCheck = deploy.indexOf(
      "node deploy/scripts/sync-public-worker-routes.mjs\n",
    );

    expect(mainGuard).toBeGreaterThan(-1);
    expect(deploy).toContain("git status --porcelain");
    expect(deploy).toContain("git rev-parse origin/main");
    expect(deploy).toContain('--commit "$deployment_commit" --status success');
    expect(deploy).toContain('[ "$checked_commit" = "$deployment_commit" ]');
    expect(mainGuard).toBeLessThan(repositoryCheck);
    expect(repositoryCheck).toBeLessThan(workerUpload);
    expect(deploy).toContain("prepare-public-release-client.sh");
    expect(workerUpload).toBeLessThan(verifyPreview);
    expect(verifyPreview).toBeLessThan(workerDeploy);
    expect(routeCheck).toBeGreaterThan(verifyPreview);
    expect(routeCheck).toBeLessThan(workerDeploy);
  });

  it("has independent version and VPS rollback paths", () => {
    const deploy = read("deploy/scripts/deploy-public-web-production.sh");
    const publicCheck = deploy.indexOf(
      'check-live-content.mjs "$public_origin"',
    );
    const automaticRollback = deploy.indexOf(
      'wrangler rollback "$previous_version"',
      publicCheck,
    );

    expect(deploy).toContain("--rollback-version");
    expect(deploy).toContain('wrangler rollback "$version_id"');
    expect(deploy).toContain("--rollback-vps");
    expect(publicCheck).toBeGreaterThan(-1);
    expect(automaticRollback).toBeGreaterThan(publicCheck);
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
