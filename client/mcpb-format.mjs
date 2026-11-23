import { tmpdir } from "node:os";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import yauzl from "yauzl";

// Published with @anthropic-ai/mcpb 2.1.2, commit 2a788100a60db19a6b1c018fb1cf84ae85de9537.
import schema from "./mcpb/mcpb-manifest-v0.4.schema.json" with { type: "json" };

export const entryPoint = "server/index.cjs";
export const maxBundleBytes = 16 * 1024 * 1024;
const manifestPath = "manifest.json";
const maxManifestBytes = 64 * 1024;
const maxSignatureBytes = 1024 * 1024;
const signatureHeader = Buffer.from("MCPB_SIG_V1");
const signatureFooter = Buffer.from("MCPB_SIG_END");
const validator = new Ajv({ ownProperties: true });
addFormats(validator, ["email", "uri"]);
const validateSchema = validator.compile(schema);

export function validateMcpbManifest(bytes) {
  if (bytes.length > maxManifestBytes)
    throw new Error("MCPB manifest exceeds its size limit");
  const manifest = JSON.parse(bytes.toString("utf8"));
  if (!validateSchema(manifest))
    throw new Error(
      `Invalid MCPB manifest: ${validateSchema.errors[0].instancePath} ${validateSchema.errors[0].message}`,
    );
  if (
    manifest.manifest_version !== "0.4" ||
    manifest.server.type !== "node" ||
    manifest.server.entry_point !== entryPoint ||
    manifest.server.mcp_config.command !== "node" ||
    manifest.server.mcp_config.args?.[0] !== "${__dirname}/" + entryPoint ||
    manifest.icon !== undefined ||
    manifest.screenshots?.length > 0 ||
    manifest.locales !== undefined
  )
    throw new Error(
      "MCPB manifest does not match the bundled files and Node entry point",
    );
  return manifest;
}

export async function signMcpb(path, certificate, key) {
  const signature = execFileSync(
    "openssl",
    [
      "cms",
      "-sign",
      "-binary",
      "-md",
      "sha256",
      "-nosmimecap",
      "-in",
      path,
      "-signer",
      certificate,
      "-inkey",
      key,
      "-outform",
      "DER",
    ],
    { stdio: ["ignore", "pipe", "pipe"], maxBuffer: maxSignatureBytes },
  );
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signature.length);
  await writeFile(
    path,
    Buffer.concat([signatureHeader, length, signature, signatureFooter]),
    {
      flag: "a",
    },
  );
}

export async function verifyMcpbSignature(bytes) {
  // The format appends a DER CMS signature preceded by its little-endian size.
  const footer = bytes.length - signatureFooter.length;
  if (footer < 0 || !bytes.subarray(footer).equals(signatureFooter))
    throw new Error("MCPB signature footer is missing");
  const header = bytes.lastIndexOf(
    signatureHeader,
    footer - signatureHeader.length - 4,
  );
  const length = header + signatureHeader.length;
  const start = length + 4;
  if (
    header <= 0 ||
    footer <= start ||
    footer - start > maxSignatureBytes ||
    bytes.readUInt32LE(length) !== footer - start
  )
    throw new Error("MCPB signature block is malformed");

  const zip = bytes.subarray(0, header);
  const directory = await mkdtemp(
    join(tmpdir(), "latex-renderer-mcpb-verify-"),
  );
  try {
    const content = join(directory, "bundle.zip");
    const signature = join(directory, "signature.der");
    await Promise.all([
      writeFile(content, zip),
      writeFile(signature, bytes.subarray(start, footer)),
    ]);
    // Release authenticity is established by the caller's authenticated metadata.
    // This independently verifies the embedded signature against the ZIP bytes.
    execFileSync(
      "openssl",
      [
        "cms",
        "-verify",
        "-binary",
        "-inform",
        "DER",
        "-in",
        signature,
        "-content",
        content,
        "-noverify",
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  return zip;
}

async function readMcpbFiles(bytes) {
  const archive = await yauzl.fromBufferPromise(bytes, {
    lazyEntries: true,
    strictFileNames: true,
  });
  try {
    if (archive.entryCount !== 2)
      throw new Error("Unexpected MCPB ZIP entry count");
    const files = new Map();
    for await (const entry of archive.eachEntry()) {
      const limit =
        entry.fileName === manifestPath ? maxManifestBytes : maxBundleBytes;
      // Older official bundles stored Unix permissions without file type bits.
      const unixType = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (
        ![manifestPath, entryPoint].includes(entry.fileName) ||
        files.has(entry.fileName) ||
        entry.uncompressedSize < 1 ||
        entry.uncompressedSize > limit ||
        (entry.versionMadeBy >>> 8 === 3 &&
          unixType !== 0 &&
          unixType !== 0o100000)
      )
        throw new Error("Unexpected MCPB ZIP entry");
      files.set(
        entry.fileName,
        await buffer(await archive.openReadStreamPromise(entry)),
      );
    }
    return { manifest: files.get(manifestPath), server: files.get(entryPoint) };
  } finally {
    archive.close();
  }
}

export async function readMcpbBundle(path) {
  // Bound the read even if the file changes between a stat and the read.
  return buffer(createReadStream(path, { end: maxBundleBytes }));
}

export async function verifyMcpbBundle(bytes, sourceManifest) {
  if (bytes.length > maxBundleBytes)
    throw new Error("MCPB archive exceeds its size limit");
  const files = await readMcpbFiles(await verifyMcpbSignature(bytes));
  const manifest = validateMcpbManifest(files.manifest);
  if (!files.manifest.equals(await readFile(sourceManifest)))
    throw new Error("Bundled MCPB manifest does not match the source manifest");
  return { manifest, server: files.server, manifestBytes: files.manifest };
}
