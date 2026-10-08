import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { isMainModule } from "../deploy/scripts/is-main-module.mjs";
import {
  parseEnvironmentFile,
  productionAuthenticationPlan,
} from "../packages/server-setup-core/src/index.mjs";
import { updaterEnvelope } from "../deploy/scripts/updater-slots.mjs";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "deployment cli "));
  roots.push(root);
  const current = join(root, "current");
  await symlink(
    resolve("."),
    current,
    process.platform === "win32" ? "junction" : "dir",
  );
  return { root, current };
}
const invoke = (entry: string, args: string[] = [], flags: string[] = []) =>
  spawnSync(process.execPath, [...flags, entry, ...args], {
    encoding: "utf8",
    timeout: 10000,
  });

it("recognizes directory aliases, relative paths and a leaf alias without recognizing imports", async () => {
  const f = await fixture(),
    physical = resolve("deploy/scripts/is-main-module.mjs"),
    alias = join(f.current, "deploy/scripts/is-main-module.mjs");
  const url = pathToFileURL(physical).href;
  expect(isMainModule(url, alias)).toBe(true);
  expect(isMainModule(url, "deploy/scripts/is-main-module.mjs")).toBe(true);
  expect(
    isMainModule(
      url,
      resolve("deploy/scripts/validate-production-profile.mjs"),
    ),
  ).toBe(false);
  expect(isMainModule(url, join(f.root, "missing"))).toBe(false);
  if (process.platform !== "win32") {
    const leaf = join(f.root, "leaf.mjs");
    await symlink(physical, leaf);
    expect(isMainModule(url, leaf)).toBe(true);
  }
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `await import(${JSON.stringify(pathToFileURL(join(f.current, "deploy/scripts/validate-production-profile.mjs")).href)});console.log('IMPORTED');`,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toBe("IMPORTED\n");
});

it.each([{ flags: [] }, { flags: ["--preserve-symlinks-main"] }])(
  "executes the real plan-field CLI through current with Node flags %j",
  async ({ flags }) => {
    const f = await fixture(),
      hook = join(f.root, "uid-fixture.mjs");
    // Only the disposable child gets a mocked UID; this branch reads no host
    // files and receives only a synthetic, secret-free plan. No OS rights change.
    await writeFile(hook, "process.geteuid=()=>0;\n");
    for (const deployment of ["cloudflare", "standalone"]) {
      const plan = productionAuthenticationPlan(
        parseEnvironmentFile(
          `DEPLOYMENT_MODE=${deployment}\nAUTH_MODE=password\nPUBLIC_ORIGIN=https://fixture.example.test\nRENDERER_PUBLIC_URL=https://fixture.example.test\n`,
        ),
      );
      const result = invoke(
        join(f.current, "deploy/scripts/validate-production-profile.mjs"),
        ["--plan-field", "deploymentMode", JSON.stringify(plan)],
        ["--import", hook, ...flags],
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe(deployment + "\n");
      const invalid = invoke(
        join(f.current, "deploy/scripts/validate-production-profile.mjs"),
        ["--plan-field", "deploymentMode", "{}"],
        ["--import", hook, ...flags],
      );
      expect(invalid.status).toBe(65);
      expect(invalid.stderr).toContain("Invalid production auth plan");
      expect(invalid.stdout).toBe("");
    }
  },
);

it.each([{ flags: [] }, { flags: ["--preserve-symlinks-main"] }])(
  "executes valid and invalid worker-version CLI through current %j",
  async ({ flags }) => {
    const f = await fixture(),
      input = join(f.root, "deployments.json"),
      entry = join(f.current, "deploy/scripts/read-active-worker-version.mjs");
    await writeFile(
      input,
      JSON.stringify([
        {
          created_on: "2026-10-08T00:00:00Z",
          versions: [{ percentage: 100, version_id: "fixture-version" }],
        },
      ]),
    );
    const result = invoke(entry, [input], flags);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("fixture-version");
    const invalid = invoke(entry, [], flags);
    expect(invalid.status).not.toBe(0);
    expect(invalid.stderr).toContain("usage:");
  },
);

it("cannot silently skip PDF/SVG reference validation through current", async () => {
  const f = await fixture(),
    log = join(f.root, "compile.log"),
    manifest = join(f.root, "manifest.json");
  const entry = join(f.current, "deploy/scripts/verify-renderer-compat.mjs");
  await writeFile(log, "invalid references\n");
  await writeFile(
    manifest,
    JSON.stringify({ schemaVersion: 2, objects: [{}, {}] }),
  );
  const result = invoke(entry, [log, manifest]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("did not resolve");
  await writeFile(
    log,
    "LR-COMPAT-REF-compile=UNRESOLVED\nLR-COMPAT-REF-compile=macro:->{1}{1}\nLR-COMPAT-REF-objects=UNRESOLVED\nLR-COMPAT-REF-objects=macro:->{1}{1}\n",
  );
  const valid = invoke(entry, [log, manifest]);
  expect(valid.status, valid.stderr).toBe(0);
});

it("includes the shared entrypoint dependency in the sealed Updater envelope", async () => {
  const source = resolve("."),
    envelope = await updaterEnvelope(source, {
      version: "1.4.0-rc.6",
      commit: "a".repeat(40),
    });
  const entry = envelope.files["deploy/scripts/is-main-module.mjs"];
  if (!entry) throw new Error("Updater entrypoint dependency is missing");
  expect(entry.bytes).toBeGreaterThan(0);
  expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  for (const path of [
    "deploy/scripts/update-manager-helper.mjs",
    "deploy/scripts/update-recovery-host.mjs",
    "deploy/scripts/release-assembly.mjs",
    "deploy/scripts/runtime-image-identity.mjs",
  ]) {
    expect(await readFile(join(source, path), "utf8")).toContain(
      'from "./is-main-module.mjs"',
    );
  }
});
