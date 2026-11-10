import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { lstat, readFile } from "node:fs/promises";

// Called only by the guarded disposable-host update E2E, after a real build.
export async function verifyRuntimeAssembly({
  assembly,
  stage,
  identity,
  run,
  rehydrate,
}) {
  for (const name of [
    "vitest",
    "typescript",
    "eslint",
    "playwright",
    "wrangler",
  ]) {
    await assert.rejects(lstat(join(assembly, "node_modules", name)), {
      code: "ENOENT",
    });
  }
  const require = createRequire(join(assembly, "package.json"));
  for (const name of [
    "acme-client",
    "@anthropic-ai/mcpb",
    "esbuild",
    "jose",
    "yazl",
  ])
    require.resolve(name);
  console.log(
    JSON.stringify({ event: "ci.runtime_dependency_selection", rehydrate }),
  );
  if (!rehydrate) return;

  // Restore build tooling only in a separate writable copy. Exercise the same
  // non-root frozen install/rebuild entry used by deployment and recovery.
  const copy = join(stage, "runtime-rehydrate");
  run("/usr/bin/rsync", ["-a", `${assembly}/`, `${copy}/`]);
  run("/usr/bin/chown", ["-R", `${identity.uid}:${identity.gid}`, copy]);
  const tooling = join(stage, "bootstrap-build/.update-tooling"),
    pnpm = join(tooling, "bin/pnpm");
  const options = {
    cwd: copy,
    uid: Number(identity.uid),
    gid: Number(identity.gid),
    env: {
      PATH: `${join(tooling, "bin")}:/usr/local/bin:/usr/bin:/bin`,
      HOME: join(tooling, "home"),
      USER: identity.deployUser,
      LOGNAME: identity.deployUser,
      COREPACK_HOME: join(tooling, "corepack"),
    },
  };
  const before = await readFile(join(copy, "pnpm-lock.yaml"));
  for (const args of [
    ["install", "--frozen-lockfile"],
    ["build:production-services"],
    ["build:client"],
  ])
    run(
      "/bin/sh",
      [join(copy, "deploy/scripts/deployment-pnpm.sh"), copy, pnpm, ...args],
      options,
    );
  assert((await readFile(join(copy, "pnpm-lock.yaml"))).equals(before));
  await lstat(join(copy, "node_modules/vitest"));
  await assert.rejects(lstat(join(assembly, "node_modules/vitest")), {
    code: "ENOENT",
  });
  const distribution = join(copy, "client-dist");
  const client = JSON.parse(
    await readFile(join(distribution, "manifest.json")),
  );
  const mcpb = JSON.parse(await readFile(join(distribution, "mcpb.json")));
  const names = ["manifest.json", "mcpb.json", client.archive, mcpb.archive];
  const prepared = await Promise.all(
    names.map((name) => readFile(join(distribution, name))),
  );
  // Exercise the production reuse path with the actual reduced-then-restored
  // dependency tree. The signatures and archive bytes must remain identical.
  for (const args of [
    ["verify:mcpb"],
    ["exec", "node", join(copy, "apps/public-web/build.mjs")],
    [
      "--filter",
      "@latex-renderer/public-web",
      "exec",
      "wrangler",
      "deploy",
      "--dry-run",
    ],
  ])
    run(
      "/bin/sh",
      [join(copy, "deploy/scripts/deployment-pnpm.sh"), copy, pnpm, ...args],
      { ...options, env: { ...options.env, WRANGLER_SEND_METRICS: "false" } },
    );
  for (const [index, name] of names.entries())
    assert((await readFile(join(distribution, name))).equals(prepared[index]));
  console.log(
    JSON.stringify({
      event: "ci.prepared_client_reuse",
      unchangedArchivesAndSignatures: true,
      publicWorkerDryRun: true,
    }),
  );
  console.log(
    JSON.stringify({
      event: "ci.runtime_dependency_rehydration",
      frozenLockfile: true,
      immutableAssembly: true,
    }),
  );
}
