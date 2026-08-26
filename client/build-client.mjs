import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
  readFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { build } from "esbuild";
import yazl from "yazl";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = join(repository, "client-dist");
const payloadName = "latex-renderer-client";
const payloadRoot = join(outputRoot, payloadName);
const version = JSON.parse(
  await readFile(join(repository, "package.json"), "utf8"),
).version;
const archiveName = `${payloadName}-${version}.zip`;
const archivePath = join(outputRoot, archiveName);
const bundleDefine = {
  "process.env.LATEX_RENDER_CLIENT_VERSION": JSON.stringify(version),
};
const workspaceAliases = {
  "@latex-renderer/api-client": join(
    repository,
    "packages/api-client/src/index.ts",
  ),
  "@latex-renderer/client-core": join(
    repository,
    "packages/client-core/src/index.ts",
  ),
  "@latex-renderer/contracts": join(
    repository,
    "packages/contracts/src/index.ts",
  ),
  "@latex-renderer/mcp-core": join(
    repository,
    "packages/mcp-core/src/index.ts",
  ),
  "@latex-renderer/setup-core": join(
    repository,
    "packages/setup-core/src/index.ts",
  ),
  "@latex-renderer/setup-web": join(
    repository,
    "packages/setup-web/src/index.ts",
  ),
  "@latex-renderer/shared": join(repository, "packages/shared/src/index.ts"),
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(join(payloadRoot, "app"), { recursive: true });
await mkdir(join(payloadRoot, "bin"), { recursive: true });
await Promise.all([
  bundle(
    "apps/cli/src/index.ts",
    join(payloadRoot, "app", "latex-render.cjs"),
    bundleDefine,
  ),
  bundle(
    "apps/mcp-server/src/index.ts",
    join(payloadRoot, "app", "latex-renderer-mcp.cjs"),
    bundleDefine,
  ),
  bundle(
    "client/install.ts",
    join(outputRoot, "install.mjs"),
    bundleDefine,
    "esm",
  ),
  bundle(
    "client/uninstall.ts",
    join(outputRoot, "uninstall.mjs"),
    bundleDefine,
    "esm",
  ),
]);
await Promise.all([
  cp(
    join(repository, "client/windows/latex-render.cmd"),
    join(payloadRoot, "bin", "latex-render.cmd"),
  ),
  cp(
    join(repository, "client/windows/latex-renderer-mcp.cmd"),
    join(payloadRoot, "bin", "latex-renderer-mcp.cmd"),
  ),
  cp(
    join(repository, "client/unix/latex-render"),
    join(payloadRoot, "bin", "latex-render"),
  ),
  cp(
    join(repository, "client/unix/latex-renderer-mcp"),
    join(payloadRoot, "bin", "latex-renderer-mcp"),
  ),
  cp(join(outputRoot, "install.mjs"), join(payloadRoot, "install.mjs")),
  cp(join(outputRoot, "uninstall.mjs"), join(payloadRoot, "uninstall.mjs")),
  cp(
    join(repository, "client/windows/install.ps1"),
    join(payloadRoot, "install.ps1"),
  ),
  cp(
    join(repository, "client/windows/uninstall.ps1"),
    join(payloadRoot, "uninstall.ps1"),
  ),
  cp(join(repository, "client/README.md"), join(payloadRoot, "README.md")),
  cp(
    join(repository, "integrations/latex-renderer"),
    join(payloadRoot, "skill"),
    { recursive: true },
  ),
  writeFile(join(payloadRoot, "VERSION"), `${version}\n`, { mode: 0o644 }),
]);
await createZip(payloadRoot, archivePath);
const archiveInfo = await stat(archivePath);
const archiveSha256 = await sha256(archivePath);
const manifest = {
  version,
  archive: archiveName,
  sha256: archiveSha256,
  size: archiveInfo.size,
  minimumNodeVersion: "24.0.0",
};
await writeFile(
  join(outputRoot, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { mode: 0o644 },
);
await cp(
  join(repository, "client/windows/install.ps1"),
  join(outputRoot, "install.ps1"),
);
await cp(
  join(repository, "client/windows/uninstall.ps1"),
  join(outputRoot, "uninstall.ps1"),
);
process.stdout.write(
  `Built ${relative(repository, archivePath)} (${archiveInfo.size} bytes, sha256 ${archiveSha256})\n`,
);

async function bundle(entry, outfile, define = {}, format = "cjs") {
  await build({
    entryPoints: [join(repository, entry)],
    outfile,
    bundle: true,
    platform: "node",
    format,
    target: "node24",
    sourcemap: false,
    legalComments: "none",
    define,
    alias: workspaceAliases,
  });
}

async function createZip(root, destination) {
  const zip = new yazl.ZipFile();
  const completion = pipeline(
    zip.outputStream,
    createWriteStream(destination, { flags: "wx", mode: 0o644 }),
  );
  for (const path of await walk(root)) {
    zip.addFile(
      path,
      `${payloadName}/${relative(root, path).replaceAll("\\", "/")}`,
      {
        mode: 0o644,
        mtime: new Date("1980-01-01T00:00:00Z"),
      },
    );
  }
  zip.end();
  await completion;
}

async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort();
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
