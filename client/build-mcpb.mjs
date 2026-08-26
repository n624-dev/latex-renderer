import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  outputRoot = join(repository, "client-dist"),
  staging = join(outputRoot, ".mcpb-build"),
  rootPackage = JSON.parse(
    await readFile(join(repository, "package.json"), "utf8"),
  ),
  sourceManifest = JSON.parse(
    await readFile(join(repository, "client/mcpb/manifest.json"), "utf8"),
  ),
  version = rootPackage.version,
  filename = `latex-renderer-local-${version}.mcpb`,
  destination = join(outputRoot, filename),
  mcpb = join(repository, "node_modules/@anthropic-ai/mcpb/dist/cli/cli.js"),
  aliases = {
    "@latex-renderer/api-client": join(repository, "packages/api-client/src/index.ts"),
    "@latex-renderer/client-core": join(repository, "packages/client-core/src/index.ts"),
    "@latex-renderer/contracts": join(repository, "packages/contracts/src/index.ts"),
    "@latex-renderer/mcp-core": join(repository, "packages/mcp-core/src/index.ts"),
    "@latex-renderer/setup-core": join(repository, "packages/setup-core/src/index.ts"),
    "@latex-renderer/shared": join(repository, "packages/shared/src/index.ts"),
    "@latex-renderer/zip-validation": join(
      repository,
      "packages/zip-validation/src/index.ts",
    ),
  };

if (sourceManifest.version !== version)
  throw new Error("MCPB manifest version must match the repository version");
await rm(staging, { recursive: true, force: true });
await rm(destination, { force: true });
await mkdir(join(staging, "server"), { recursive: true });
await cp(
  join(repository, "client/mcpb/manifest.json"),
  join(staging, "manifest.json"),
);
await build({
  entryPoints: [join(repository, "apps/mcp-server/src/index.ts")],
  outfile: join(staging, "server/index.cjs"),
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

execFileSync(process.execPath, [mcpb, "validate", join(staging, "manifest.json")], {
  cwd: repository,
  stdio: "inherit",
});
execFileSync(process.execPath, [mcpb, "pack", staging, destination], {
  cwd: repository,
  stdio: "inherit",
});

const signingRoot = await mkdtemp(join(tmpdir(), "latex-renderer-mcpb-sign-"));
try {
  let certificate = process.env.MCPB_SIGNING_CERT_FILE,
    key = process.env.MCPB_SIGNING_KEY_FILE;
  if ((certificate === undefined) !== (key === undefined))
    throw new Error("MCPB signing certificate and key must be provided together");
  if (certificate === undefined || key === undefined) {
    certificate = join(signingRoot, "certificate.pem");
    key = join(signingRoot, "key.pem");
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
      { cwd: signingRoot, stdio: "ignore" },
    );
  }
  execFileSync(
    process.execPath,
    [mcpb, "sign", destination, "--cert", certificate, "--key", key],
    { cwd: signingRoot, stdio: "inherit" },
  );
  await verifyDetachedSignature(destination, signingRoot);
} finally {
  await rm(signingRoot, { recursive: true, force: true });
  await rm(staging, { recursive: true, force: true });
}

const info = await stat(destination),
  digest = await sha256(destination),
  metadata = {
    version,
    archive: filename,
    sha256: digest,
    size: info.size,
    signature: "pkcs7",
  };
await writeFile(
  join(outputRoot, "mcpb.json"),
  `${JSON.stringify(metadata, null, 2)}\n`,
  { mode: 0o644 },
);
process.stdout.write(
  `Built client-dist/${filename} (${info.size} bytes, sha256 ${digest})\n`,
);

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyDetachedSignature(path, workDirectory) {
  const bytes = await readFile(path),
    footer = Buffer.from("MCPB_SIG_END"),
    header = Buffer.from("MCPB_SIG_V1"),
    footerIndex = bytes.lastIndexOf(footer),
    headerIndex = bytes.lastIndexOf(header, footerIndex);
  if (footerIndex < 0 || headerIndex < 0)
    throw new Error("MCPB signature block is missing");
  const lengthOffset = headerIndex + header.byteLength,
    signatureLength = bytes.readUInt32LE(lengthOffset),
    signatureOffset = lengthOffset + 4;
  if (signatureOffset + signatureLength !== footerIndex)
    throw new Error("MCPB signature block is malformed");
  const contentPath = join(workDirectory, "content.mcpb"),
    signaturePath = join(workDirectory, "signature.p7s");
  await Promise.all([
    writeFile(contentPath, bytes.subarray(0, headerIndex)),
    writeFile(
      signaturePath,
      bytes.subarray(signatureOffset, signatureOffset + signatureLength),
    ),
  ]);
  execFileSync(
    "openssl",
    [
      "cms",
      "-verify",
      "-binary",
      "-inform",
      "DER",
      "-in",
      signaturePath,
      "-content",
      contentPath,
      "-noverify",
      "-out",
      join(workDirectory, "verified-content"),
    ],
    { cwd: workDirectory, stdio: "ignore" },
  );
}
