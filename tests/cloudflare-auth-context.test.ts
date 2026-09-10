import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

describe("Cloudflare OAuth deployment build context", () => {
  it.skipIf(process.platform === "win32").each([0, 2, 1, 42])(
    "preflight exit %i only allows success or a valid change plan",
    (status) => {
      const script = readFileSync(
        "deploy/scripts/deploy-production-release.sh",
        "utf8",
      );
      const start = script.indexOf("# Probe the same OAuth fallback");
      const end = script.indexOf("  gateway_runtime_config=$(mktemp", start);
      expect(start).toBeGreaterThan(0);
      expect(end).toBeGreaterThan(start);
      const block = script
        .slice(start, end)
        .replace(/if \[ "\$deployment_mode" = cloudflare \]; then\s*$/, "");
      const result = spawnSync(
        "sh",
        [
          "-c",
          `set -eu
      . "$1"
      deployment_mode=cloudflare
      source_root=/sealed-control
      run_deployment_pnpm() { return ${status}; }
      ${block}
      echo PREFLIGHT_PASS
    `,
          "preflight-fixture",
          resolve("deploy/scripts/deployment-checks.sh"),
        ],
        { encoding: "utf8" },
      );
      expect(result.status === 0, result.stderr).toBe(status === 0 || status === 2);
      expect(result.stdout.includes("PREFLIGHT_PASS")).toBe(
        status === 0 || status === 2,
      );
    },
  );
  it
    .skipIf(process.platform === "win32")
    .each([
      "sync-public-worker-routes.mjs",
      "sync-cloudflare-tunnel-config.mjs",
    ])("%s obtains credentials from the prepared writable tree", (script) => {
    const root = mkdtempSync(join(tmpdir(), "renderer-cloudflare-auth-"));
    try {
      const bin = join(root, "bin");
      const build = join(root, "build");
      mkdirSync(bin);
      mkdirSync(build);
      writeFileSync(
        join(bin, "pnpm"),
        `#!/bin/sh
set -eu
[ "$PWD" = "$LATEX_RENDERER_BUILD_ROOT" ] || exit 42
[ "$*" = 'exec wrangler auth token --json' ] || exit 43
[ "$PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN" = error ] || exit 44
[ "$PNPM_CONFIG_STORE_DIR" = "$PWD/.deployment-tooling/store" ] || exit 45
printf '%s\\n' '{"token":"test-only-credential"}'
`,
        { mode: 0o700 },
      );
      const moduleUrl = pathToFileURL(resolve("deploy/scripts", script)).href;
      const result = spawnSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `
        import {authenticationToken} from ${JSON.stringify(moduleUrl)};
        if(authenticationToken()!=='test-only-credential')process.exit(1);
        console.log('AUTH_CONTEXT_PASS');
      `,
        ],
        {
          encoding: "utf8",
          timeout: 10_000,
          cwd: "/",
          env: {
            ...process.env,
            PATH: `${bin}:${process.env.PATH}`,
            CLOUDFLARE_API_TOKEN: "",
            LATEX_RENDERER_BUILD_ROOT: build,
            PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "error",
            PNPM_CONFIG_STORE_DIR: join(build, ".deployment-tooling/store"),
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim()).toBe("AUTH_CONTEXT_PASS");
      expect(result.stderr).not.toContain("test-only-credential");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preflights both sync paths before quiescing and uses the same wrapper for apply", () => {
    const script = readFileSync(
      "deploy/scripts/deploy-production-release.sh",
      "utf8",
    );
    const quiesce = script.indexOf(
      'sh "$source_root/deploy/scripts/quiesce-image-manager.sh"',
    );
    for (const name of [
      "sync-public-worker-routes.mjs",
      "sync-cloudflare-tunnel-config.mjs",
    ]) {
      const invocation = `run_deployment_pnpm exec node "$source_root/deploy/scripts/${name}"`;
      const preflight = script.indexOf(`${invocation} || [ "$?" -eq 2 ]`);
      expect(preflight).toBeGreaterThan(
        script.indexOf("run_deployment_pnpm install --frozen-lockfile"),
      );
      expect(preflight).toBeLessThan(quiesce);
      expect(script.indexOf(`${invocation} --apply`)).toBeGreaterThan(quiesce);
    }
  });
});
