import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("noninteractive deployment dependencies", () => {
  it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
    "reconciles a relocated workspace, preserves its lockfile, and refuses later drift",
    () => {
      const root = mkdtempSync(join(tmpdir(), "renderer-deployment-pnpm-"));
      const source = join(root, "original");
      const target = join(root, "deployment");
      const wrapper = resolve("deploy/scripts/deployment-pnpm.sh");
      const pnpm = spawnSync("sh", ["-c", "command -v pnpm"], {
        encoding: "utf8",
      }).stdout.trim();
      const metadata = JSON.parse(readFileSync("package.json", "utf8")) as {
        packageManager: string;
      };
      try {
        mkdirSync(source);
        writeFileSync(
          join(source, "package.json"),
          JSON.stringify({
            name: "deployment-fixture",
            private: true,
            packageManager: metadata.packageManager,
            scripts: {
              outer: "pnpm run inner",
              inner: "node -e \"console.log('DEPLOYMENT_FIXTURE_PASS')\"",
            },
          }),
        );
        writeFileSync(join(source, "pnpm-workspace.yaml"), "packages: []\n");
        const installed = spawnSync(
          pnpm,
          ["--dir", source, "install", "--store-dir", join(root, "old-store")],
          {
            encoding: "utf8",
            env: { ...process.env, CI: "true" },
            timeout: 30_000,
          },
        );
        expect(installed.status, installed.stderr).toBe(0);
        cpSync(source, target, { recursive: true });
        const lock = readFileSync(join(target, "pnpm-lock.yaml"), "utf8");
        const run = (...args: string[]) =>
          spawnSync("sh", [wrapper, target, pnpm, ...args], {
            encoding: "utf8",
            cwd: "/",
            timeout: 30_000,
            env: { ...process.env, CI: "false" },
          });
        const prepared = run("install", "--frozen-lockfile");
        expect(prepared.status, prepared.stdout + prepared.stderr).toBe(0);
        const nested = run("run", "outer");
        expect(nested.status, nested.stdout + nested.stderr).toBe(0);
        expect(nested.stdout).toContain("DEPLOYMENT_FIXTURE_PASS");
        expect(readFileSync(join(target, "pnpm-lock.yaml"), "utf8")).toBe(lock);
        const packagePath = join(target, "package.json");
        const changed = JSON.parse(readFileSync(packagePath, "utf8")) as Record<
          string,
          unknown
        >;
        changed.dependencies = { "fixture-must-not-download": "1.0.0" };
        writeFileSync(packagePath, JSON.stringify(changed));
        const refused = run("run", "outer");
        expect(refused.status).not.toBe(0);
        expect(refused.stdout + refused.stderr).toContain(
          "VERIFY_DEPS_BEFORE_RUN",
        );
        const frozen = run("install", "--frozen-lockfile");
        expect(frozen.status).not.toBe(0);
        expect(frozen.stdout + frozen.stderr).toContain("OUTDATED_LOCKFILE");
        expect(readFileSync(join(target, "pnpm-lock.yaml"), "utf8")).toBe(lock);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
