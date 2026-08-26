import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
  outputRoot = join(repository, "client-dist"),
  metadata = JSON.parse(readFileSync(join(outputRoot, "mcpb.json"), "utf8")),
  archive =
    process.argv[2] === undefined
      ? join(outputRoot, metadata.archive)
      : resolve(process.argv[2]),
  bytes = readFileSync(archive),
  mcpb = join(repository, "node_modules/@anthropic-ai/mcpb/dist/cli/cli.js");
if (statSync(archive).size !== metadata.size)
  throw new Error("MCPB size does not match its metadata");
if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256)
  throw new Error("MCPB SHA-256 does not match its metadata");
verifyDetachedSignature(bytes);
execFileSync(process.execPath, [mcpb, "validate", join(repository, "client/mcpb/manifest.json")], {
  cwd: repository,
  stdio: "inherit",
});
process.stdout.write(`Verified ${archive}\n`);

function verifyDetachedSignature(bytes) {
  const footer = Buffer.from("MCPB_SIG_END"),
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
  const directory = mkdtempSync(join(tmpdir(), "latex-renderer-mcpb-verify-"));
  try {
    const content = join(directory, "content.mcpb"),
      signature = join(directory, "signature.p7s");
    writeFileSync(content, bytes.subarray(0, headerIndex));
    writeFileSync(
      signature,
      bytes.subarray(signatureOffset, signatureOffset + signatureLength),
    );
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
        "-out",
        join(directory, "verified-content"),
      ],
      { stdio: "ignore" },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
