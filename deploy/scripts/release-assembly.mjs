import { lstat, readdir, readlink, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  const canonicalRoot = await realpath(root);
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      const target = resolve(dirname(path), await readlink(path));
      if (target !== root && !target.startsWith(`${root}/`))
        throw new Error(`Build output symlink escapes the release: ${path}`);
      const canonicalTarget = await realpath(target);
      if (
        canonicalTarget !== canonicalRoot &&
        !canonicalTarget.startsWith(`${canonicalRoot}/`)
      )
        throw new Error(`Build output symlink escapes the release: ${path}`);
    } else if (entry.isDirectory()) {
      await assertContainedSymlinks(root, path);
    } else if (!entry.isFile()) {
      throw new Error(
        `Build output contains a special filesystem entry: ${path}`,
      );
    }
  }
}

export async function assertSealedControlTree(root, expectedUid = 0) {
  const absoluteRoot = resolve(root);
  const rootEntry = await lstat(absoluteRoot);
  if (!rootEntry.isDirectory())
    throw new Error("Control tree root must be a directory");
  const canonicalRoot = await realpath(absoluteRoot);
  await inspectSealedEntry(
    absoluteRoot,
    canonicalRoot,
    absoluteRoot,
    expectedUid,
    rootEntry.dev,
  );
}

async function inspectSealedEntry(
  root,
  canonicalRoot,
  path,
  expectedUid,
  expectedDevice,
) {
  const entry = await lstat(path);
  if (entry.uid !== expectedUid)
    throw new Error(`Control tree entry has an unexpected owner: ${path}`);
  if (entry.dev !== expectedDevice)
    throw new Error(`Control tree crosses a filesystem boundary: ${path}`);
  if (entry.isSymbolicLink()) {
    // POSIX symlink mode bits are normally reported as 0777 and do not grant
    // write access to the link.  Ownership and a contained, existing target
    // are the security properties that matter for a sealed symlink.
    const target = resolve(dirname(path), await readlink(path));
    if (target !== root && !target.startsWith(`${root}/`))
      throw new Error(`Control tree symlink escapes the release: ${path}`);
    const canonicalTarget = await realpath(target);
    if (
      canonicalTarget !== canonicalRoot &&
      !canonicalTarget.startsWith(`${canonicalRoot}/`)
    )
      throw new Error(`Control tree symlink escapes the release: ${path}`);
    return;
  }
  if ((entry.mode & 0o022) !== 0)
    throw new Error(`Control tree entry is group/world-writable: ${path}`);
  if (entry.isDirectory()) {
    for (const child of await readdir(path))
      await inspectSealedEntry(
        root,
        canonicalRoot,
        join(path, child),
        expectedUid,
        expectedDevice,
      );
  } else if (!entry.isFile()) {
    throw new Error(
      `Control tree contains a special filesystem entry: ${path}`,
    );
  }
}

async function main() {
  const [verb, root, ...extra] = process.argv.slice(2);
  if (
    verb !== "--assert-sealed-control-tree" ||
    typeof root !== "string" ||
    extra.length !== 0
  ) {
    throw new Error(
      "usage: release-assembly.mjs --assert-sealed-control-tree ABSOLUTE_ROOT",
    );
  }
  if (resolve(root) !== root)
    throw new Error("Control tree root must be an absolute normalized path");
  await assertSealedControlTree(root);
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  await main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
