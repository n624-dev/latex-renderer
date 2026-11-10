import { execFileSync } from "node:child_process";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, expect, it } from "vitest";
import { pruneRuntimeDependencies } from "../deploy/scripts/release-runtime.mjs";
import {
  assembleBuildArtifacts,
  requiredProductionBuildOutputs,
  validateBuildArtifacts,
} from "../deploy/scripts/release-assembly.mjs";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function directory() {
  const root = await mkdtemp(join(tmpdir(), "release-runtime-"));
  roots.push(root);
  return root;
}
async function file(root: string, path: string, value: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), value);
}
async function json(root: string, path: string, value: object) {
  await file(root, path, JSON.stringify(value));
}
async function alias(root: string, path: string, target: string) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await symlink(
    relative(dirname(join(root, path)), join(root, target)),
    join(root, path),
  );
}
async function fixture() {
  const root = await directory();
  await json(root, "deploy/runtime-dependencies.json", {
    schemaVersion: 1,
    rootPackages: ["tool"],
    requiredFiles: ["node_modules/tool/run.js"],
  });
  await json(root, "package.json", {
    dependencies: { prod: "1" },
    devDependencies: { dev: "1", tool: "1" },
  });
  await json(root, "apps/service/package.json", {
    dependencies: { workspace: "workspace:*" },
  });
  await json(root, "packages/workspace/package.json", {
    name: "workspace",
    dependencies: { prod: "1" },
    bin: "unbuilt-cli.js",
  });
  for (const [name, value] of Object.entries({
    prod: {
      dependencies: { transitive: "1" },
      optionalDependencies: { absent: "1", optional: "1" },
      peerDependencies: { peer: "1", missingPeer: "1" },
    },
    transitive: {},
    optional: {},
    peer: {},
    dev: { bin: { dev: "run.js" } },
    tool: { bin: { tool: "run.js" } },
  })) {
    const path = `node_modules/.pnpm/${name}@1/node_modules/${name}`;
    await json(root, `${path}/package.json`, { name, ...value });
    await file(root, `${path}/run.js`, name);
    await alias(root, `node_modules/${name}`, path);
    await alias(root, `node_modules/.pnpm/node_modules/${name}`, path);
  }
  for (const name of ["transitive", "optional", "peer"])
    await alias(
      root,
      `node_modules/.pnpm/prod@1/node_modules/${name}`,
      `node_modules/.pnpm/${name}@1/node_modules/${name}`,
    );
  await alias(
    root,
    "apps/service/node_modules/workspace",
    "packages/workspace",
  );
  await file(root, "node_modules/.bin/dev", "dev wrapper");
  await file(root, "node_modules/.bin/tool", "tool wrapper");
  await file(root, "node_modules/.pnpm/lock.yaml", "immutable lock");
  return root;
}
it("keeps production, workspace, installed optional/peer and explicit management dependencies; removes development slots and wrappers", async () => {
  const root = await fixture();
  const manifest = await readFile(join(root, "package.json"), "utf8");
  const result = await pruneRuntimeDependencies(root);
  expect(result).toMatchObject({ enabled: true, removedPackages: 1 });
  expect(await readdir(join(root, "node_modules/.pnpm"))).not.toContain(
    "dev@1",
  );
  await expect(lstat(join(root, "node_modules/dev"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(
    lstat(join(root, "node_modules/.pnpm/node_modules/dev")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readdir(join(root, "node_modules/.bin"))).toEqual(["tool"]);
  expect(await readFile(join(root, "node_modules/prod/run.js"), "utf8")).toBe(
    "prod",
  );
  expect(
    await readFile(join(root, "node_modules/.pnpm/lock.yaml"), "utf8"),
  ).toBe("immutable lock");
  expect(await readFile(join(root, "package.json"), "utf8")).toBe(manifest);
  expect(await pruneRuntimeDependencies(root)).toMatchObject({
    removedPackages: 0,
  });
});
it("does not prune historical releases without an explicit policy", async () => {
  const root = await fixture();
  await rm(join(root, "deploy/runtime-dependencies.json"));
  expect(await pruneRuntimeDependencies(root)).toMatchObject({
    enabled: false,
  });
  await lstat(join(root, "node_modules/dev"));
});
it.each(["missing", "policy", "permission", "external", "store-link"])(
  "rejects unsafe or incomplete assemblies before deletion: %s",
  async (kind) => {
    const root = await fixture(),
      outside = await directory();
    await file(outside, "sentinel", "keep");
    if (kind === "missing")
      await json(root, "package.json", { dependencies: { missing: "1" } });
    if (kind === "policy")
      await json(root, "deploy/runtime-dependencies.json", {
        schemaVersion: 1,
        rootPackages: ["../outside"],
        requiredFiles: [],
      });
    if (kind === "permission") await chmod(root, 0o750);
    if (kind === "external") await symlink(outside, join(root, "outside"));
    if (kind === "store-link") {
      await rm(join(root, "node_modules/.pnpm"), { recursive: true });
      await symlink(outside, join(root, "node_modules/.pnpm"));
    }
    await expect(pruneRuntimeDependencies(root)).rejects.toThrow();
    expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("keep");
    if (kind !== "store-link")
      await lstat(join(root, "node_modules/.pnpm/dev@1"));
  },
);
it("uses verified selection policy and controls while pruning only the new assembly", async () => {
  const buildSource = await fixture(),
    verifiedSource = await directory(),
    assembly = await directory();
  await cp(join(buildSource, "deploy"), join(verifiedSource, "deploy"), {
    recursive: true,
  });
  for (const path of [
    "package.json",
    "apps/service/package.json",
    "packages/workspace/package.json",
  ])
    await file(
      verifiedSource,
      path,
      await readFile(join(buildSource, path), "utf8"),
    );
  await file(
    verifiedSource,
    "deploy/scripts/prepare-host.sh",
    "signed control",
  );
  await file(
    buildSource,
    "deploy/scripts/prepare-host.sh",
    "untrusted control",
  );
  await json(buildSource, "deploy/runtime-dependencies.json", {
    schemaVersion: 9,
  });
  for (const path of requiredProductionBuildOutputs)
    await file(buildSource, path, "built");
  await chmod(verifiedSource, 0o755);
  await chmod(buildSource, 0o775);
  await chmod(join(verifiedSource, "deploy/scripts/prepare-host.sh"), 0o755);
  let privateCopies = 0;
  await assembleBuildArtifacts({
    verifiedSource,
    buildSource,
    assembly,
    runCommand: async (command, args) => {
      execFileSync(command, args);
      const info = await lstat(assembly);
      expect(info.uid).toBe(process.getuid?.());
      expect(info.mode & 0o777).toBe(0o700);
      privateCopies++;
    },
  });
  expect(privateCopies).toBe(2);
  expect(
    (await lstat(join(assembly, "deploy/scripts/prepare-host.sh"))).mode &
      0o111,
  ).toBe(0o111);
  expect(
    await readFile(join(assembly, "deploy/scripts/prepare-host.sh"), "utf8"),
  ).toBe("signed control");
  await expect(lstat(join(assembly, "node_modules/dev"))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
  await lstat(join(buildSource, "node_modules/dev"));
});
it("validates derived outputs directly, excludes operation tooling, and rejects escaping or missing outputs", async () => {
  const buildSource = await directory(),
    verifiedSource = await directory(),
    outside = await directory();
  for (const path of requiredProductionBuildOutputs)
    await file(buildSource, path, "built");
  await mkdir(join(buildSource, ".update-tooling"));
  await symlink(outside, join(buildSource, ".update-tooling/corepack"));
  await validateBuildArtifacts({ verifiedSource, buildSource });
  await symlink(outside, join(buildSource, "apps/admin-api/dist/escape"));
  await expect(
    validateBuildArtifacts({ verifiedSource, buildSource }),
  ).rejects.toThrow(/escapes/);
  await rm(join(buildSource, "apps/admin-api/dist/escape"));
  const firstOutput = requiredProductionBuildOutputs[0];
  if (!firstOutput) throw new Error("Missing production output contract");
  await rm(join(buildSource, firstOutput));
  await expect(
    validateBuildArtifacts({ verifiedSource, buildSource }),
  ).rejects.toThrow();
});
