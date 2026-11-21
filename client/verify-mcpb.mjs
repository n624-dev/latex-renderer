import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import process from "node:process";
import { readMcpbBundle, verifyMcpbBundle } from "./mcpb-format.mjs";

const repository = resolve(import.meta.dirname, "..");
const outputRoot = join(repository, "client-dist");
const metadata = JSON.parse(
  await readFile(process.argv[3] ?? join(outputRoot, "mcpb.json"), "utf8"),
);
const archive = process.argv[2] ?? join(outputRoot, metadata.archive);
const bytes = await readMcpbBundle(archive);
if (bytes.length !== metadata.size)
  throw new Error("MCPB size does not match its metadata");
if (createHash("sha256").update(bytes).digest("hex") !== metadata.sha256)
  throw new Error("MCPB SHA-256 does not match its metadata");
const { manifest } = await verifyMcpbBundle(
  bytes,
  join(repository, "client/mcpb/manifest.json"),
);
if (manifest.version !== metadata.version || metadata.signature !== "pkcs7")
  throw new Error("MCPB version or signature type does not match its metadata");
process.stdout.write(`Verified ${archive}\n`);
