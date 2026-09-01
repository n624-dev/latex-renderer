import { lstat, readdir, readlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const requiredProductionBuildOutputs = [
  "apps/admin-api/dist/server.js",
  "apps/admin-local/dist/index.js",
  "apps/admin-web/dist/server.js",
  "apps/internal-api/dist/server.js",
  "apps/remote-mcp/dist/server.js",
  "apps/renderer-api/dist/server.js",
  "apps/renderer-worker/dist/index.js",
  "apps/standalone-gateway/dist/server.js",
  "client-dist/manifest.json",
];

export async function assembleBuildArtifacts({
  verifiedSource,
  buildSource,
  assembly,
  runCommand,
}) {
  await runCommand("rsync", ["-a", `${verifiedSource}/`, `${assembly}/`]);
  await runCommand("rsync", [
    "-a",
    "--prune-empty-dirs",
    "--include=/node_modules/***",
    "--include=/client-dist/***",
    "--include=/apps/",
    "--include=/apps/*/",
    "--include=/apps/*/dist/***",
    "--include=/apps/*/node_modules/***",
    "--include=/packages/",
    "--include=/packages/*/",
    "--include=/packages/*/dist/***",
    "--include=/packages/*/node_modules/***",
    "--exclude=*",
    `${buildSource}/`,
    `${assembly}/`,
  ]);
  for (const requiredPath of requiredProductionBuildOutputs) {
    const entry = await lstat(join(assembly, requiredPath));
    if (!entry.isFile())
      throw new Error(
        `Required production build output is missing: ${requiredPath}`,
      );
  }
  await assertContainedSymlinks(assembly, assembly);
}

export async function assertContainedSymlinks(root, directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path));
      if (target !== root && !target.startsWith(`${root}/`))
        throw new Error(`Build output symlink escapes the release: ${path}`);
      await lstat(target);
    } else if (entry.isDirectory()) {
      await assertContainedSymlinks(root, path);
    } else if (!entry.isFile()) {
      throw new Error(`Build output contains a special filesystem entry: ${path}`);
    }
  }
}
