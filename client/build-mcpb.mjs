import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  rename,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import yazl from "yazl";
import {
  entryPoint,
  readMcpbBundle,
  signMcpb,
  validateMcpbManifest,
  verifyMcpbBundle,
} from "./mcpb-format.mjs";
import { build } from "esbuild";

const repository = resolve(import.meta.dirname, ".."),
  outputRoot = join(repository, "client-dist"),
  rootPackage = JSON.parse(
    await readFile(join(repository, "package.json"), "utf8"),
  ),
  sourceManifest = join(repository, "client/mcpb/manifest.json"),
  manifestBytes = await readFile(sourceManifest),
  version = rootPackage.version,
  filename = `latex-renderer-local-${version}.mcpb`,
  destination = join(outputRoot, filename),
  aliases = {
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
    "@latex-renderer/shared": join(repository, "packages/shared/src/index.ts"),
    "@latex-renderer/shared/locale": join(repository, "packages/shared/src/locale.ts"),
    "@latex-renderer/zip-validation": join(
      repository,
      "packages/zip-validation/src/index.ts",
    ),
  };

if (validateMcpbManifest(manifestBytes).version !== version)
  throw new Error("MCPB manifest version must match the repository version");

await mkdir(outputRoot, { recursive: true });
const staging = await mkdtemp(join(outputRoot, ".mcpb-build-"));
try {
  await build({
    entryPoints: [join(repository, "apps/mcp-server/src/index.ts")],
    outfile: join(staging, entryPoint),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    sourcemap: false,
    legalComments: "none",
    define: {
      "process.env.LATEX_RENDER_CLIENT_VERSION": JSON.stringify(version),
    },
    alias: aliases,
  });

  const archive = join(staging, filename);
  const zip = new yazl.ZipFile();
  const zipOptions = {
    mode: 0o100644,
    mtime: new Date("1980-01-01T00:00:00Z"),
  };
  const packed = pipeline(
    zip.outputStream,
    createWriteStream(archive, { flags: "wx", mode: 0o644 }),
  );
  zip.addBuffer(manifestBytes, "manifest.json", zipOptions);
  zip.addFile(join(staging, entryPoint), entryPoint, {
    ...zipOptions,
    mode: 0o100755,
  });
  zip.end();
  await packed;

  let certificate = process.env.MCPB_SIGNING_CERT_FILE,
    key = process.env.MCPB_SIGNING_KEY_FILE;
  if ((certificate === undefined) !== (key === undefined))
    throw new Error(
      "MCPB signing certificate and key must be provided together",
    );
  if (certificate === undefined || key === undefined) {
    certificate = join(staging, "certificate.pem");
    key = join(staging, "key.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:3072",
        "-keyout",
        key,
        "-out",
        certificate,
        "-sha256",
        "-days",
        "30",
        "-nodes",
        "-subj",
        "/CN=latex-renderer-local-ci",
        "-addext",
        "extendedKeyUsage=codeSigning",
      ],
      { cwd: staging, stdio: "ignore" },
    );
  }
  await signMcpb(archive, certificate, key);
  const bytes = await readMcpbBundle(archive);
  await verifyMcpbBundle(bytes, sourceManifest);
  const metadata = {
    version,
    archive: filename,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.length,
    signature: "pkcs7",
  };
  const stagedMetadata = join(staging, "mcpb.json");
  await writeFile(stagedMetadata, `${JSON.stringify(metadata, null, 2)}\n`, {
    mode: 0o644,
  });
  await rename(archive, destination);
  await rename(stagedMetadata, join(outputRoot, "mcpb.json"));
  process.stdout.write(
    `Built client-dist/${filename} (${metadata.size} bytes, sha256 ${metadata.sha256})\n`,
  );
} finally {
  await rm(staging, { recursive: true, force: true });
}
