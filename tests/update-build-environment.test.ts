import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { updateBuildEnvironment } from "../deploy/scripts/update-build-environment.mjs";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0))
    rmSync(path, { recursive: true, force: true });
});

it("bounds installation without leaking its heap setting into compilation", () => {
  const environment = {
    NODE_OPTIONS: "--enable-source-maps",
    PNPM_CONFIG_STORE_DIR: "/private/staging/store",
    PNPM_CONFIG_FROZEN_LOCKFILE: "true",
  };
  const installed = updateBuildEnvironment(environment, "install");
  expect(installed).toMatchObject({
    ...environment,
    NODE_OPTIONS: "--enable-source-maps --max-old-space-size=256",
    PNPM_MAX_WORKERS: "1",
    PNPM_CONFIG_NETWORK_CONCURRENCY: "4",
    PNPM_CONFIG_CHILD_CONCURRENCY: "1",
  });
  const heapLimit = (env: NodeJS.ProcessEnv) =>
    Number(
      execFileSync(
        process.execPath,
        [
          "-e",
          "console.log(require('node:v8').getHeapStatistics().heap_size_limit)",
        ],
        { env, encoding: "utf8" },
      ),
    );
  // V8 adds a machine-dependent young generation to the old-space setting.
  // Compare two settings on this same host rather than assuming that overhead.
  expect(heapLimit(installed)).toBeLessThan(
    heapLimit({
      ...installed,
      NODE_OPTIONS: "--enable-source-maps --max-old-space-size=512",
    }),
  );
  expect(
    updateBuildEnvironment(environment, "build:production-services"),
  ).toEqual({ ...environment, PNPM_CONFIG_WORKSPACE_CONCURRENCY: "1" });
  expect(updateBuildEnvironment(environment, "build:client")).toEqual(
    environment,
  );
  expect(environment.NODE_OPTIONS).toBe("--enable-source-maps");
  expect(updateBuildEnvironment({}, "install").NODE_OPTIONS).toBe(
    "--max-old-space-size=256",
  );
});

it.skipIf(process.platform !== "linux" || process.getuid?.() === 0)(
  "the real deployment shell preserves step isolation and frozen/store guards",
  () => {
    const root = mkdtempSync(join(tmpdir(), "update-build-env-"));
    temporary.push(root);
    const pnpm = join(root, "pnpm");
    const { packageManager } = JSON.parse(
      readFileSync("package.json", "utf8"),
    ) as { packageManager: string };
    const version = packageManager.slice("pnpm@".length);
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ packageManager }),
    );
    writeFileSync(
      pnpm,
      `#!/bin/sh
if [ "$1" = --version ]; then echo ${version}; exit 0; fi
exec node -e 'console.log(JSON.stringify(Object.fromEntries(Object.entries(process.env).filter(([k])=>k.startsWith("PNPM_")||k==="NODE_OPTIONS"))))'
`,
      { mode: 0o700 },
    );
    const wrapper = resolve("deploy/scripts/deployment-pnpm.sh");
    const original = { ...process.env, NODE_OPTIONS: "--enable-source-maps" };
    for (const command of [
      "install",
      "build:production-services",
      "build:client",
    ]) {
      const result = spawnSync("sh", [wrapper, root, pnpm, command], {
        env: original,
        encoding: "utf8",
      });
      expect(result.status, result.stderr).toBe(0);
      const actual = JSON.parse(result.stdout) as NodeJS.ProcessEnv;
      const expected = updateBuildEnvironment(
        {
          ...original,
          PNPM_CONFIG_STORE_DIR: join(root, ".deployment-tooling/store"),
          PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN: "error",
          PNPM_CONFIG_FROZEN_LOCKFILE: "true",
        },
        command,
      );
      for (const [key, value] of Object.entries(expected))
        if (key.startsWith("PNPM_") || key === "NODE_OPTIONS")
          expect(actual[key], `${command}: ${key}`).toBe(value);
    }
  },
);
