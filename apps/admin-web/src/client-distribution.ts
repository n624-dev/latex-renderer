import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ClientDistribution {
  version: string;
  archiveName: string;
  manifest: Uint8Array;
  installer: Uint8Array;
  uninstaller: Uint8Array;
  commonInstaller: Uint8Array;
  commonUninstaller: Uint8Array;
  archive: Uint8Array;
  mcpbName?: string;
  mcpbMetadata?: Uint8Array;
  mcpb?: Uint8Array;
  gatewayOpenApi: Uint8Array;
  rendererOpenApi: Uint8Array;
  adminOpenApi: Uint8Array;
}
export function loadClientDistribution(root: string): ClientDistribution {
  const manifest = readFileSync(join(root, "manifest.json")),
    value = JSON.parse(manifest.toString("utf8")) as unknown;
  if (!isManifest(value))
    throw new Error("Client distribution manifest is invalid");
  const archive = readFileSync(join(root, value.archive));
  if (
    archive.byteLength !== value.size ||
    createHash("sha256").update(archive).digest("hex") !== value.sha256
  )
    throw new Error("Client distribution archive integrity check failed");
  const mcpbMetadata = readFileSync(join(root, "mcpb.json")),
    mcpbValue = JSON.parse(mcpbMetadata.toString("utf8")) as unknown;
  if (!isMcpbManifest(mcpbValue))
    throw new Error("MCPB distribution metadata is invalid");
  const mcpb = readFileSync(join(root, mcpbValue.archive));
  if (
    mcpb.byteLength !== mcpbValue.size ||
    createHash("sha256").update(mcpb).digest("hex") !== mcpbValue.sha256
  )
    throw new Error("MCPB distribution integrity check failed");
  const repositoryRoot = join(root, "..");
  return {
    version: value.version,
    archiveName: value.archive,
    manifest,
    installer: readFileSync(join(root, "install.ps1")),
    uninstaller: readFileSync(join(root, "uninstall.ps1")),
    commonInstaller: readFileSync(join(root, "install.mjs")),
    commonUninstaller: readFileSync(join(root, "uninstall.mjs")),
    archive,
    mcpbName: mcpbValue.archive,
    mcpbMetadata,
    mcpb,
    gatewayOpenApi: readFileSync(
      join(repositoryRoot, "openapi", "gateway.openapi.yaml"),
    ),
    rendererOpenApi: readFileSync(
      join(repositoryRoot, "openapi", "renderer.openapi.yaml"),
    ),
    adminOpenApi: readFileSync(
      join(repositoryRoot, "openapi", "admin.openapi.yaml"),
    ),
  };
}
function isMcpbManifest(
  value: unknown,
): value is { version: string; archive: string; sha256: string; size: number } {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isReleaseVersion(item.version) &&
    item.archive === `latex-renderer-local-${item.version}.mcpb` &&
    typeof item.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(item.sha256) &&
    typeof item.size === "number" &&
    Number.isSafeInteger(item.size) &&
    item.size > 0
  );
}
export function binaryResponse(
  body: Uint8Array,
  contentType: string,
  downloadName?: string,
): Response {
  const payload = new ArrayBuffer(body.byteLength);
  new Uint8Array(payload).set(body);
  return new Response(payload, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
      "Cache-Control":
        "private, no-store, no-cache, max-age=0, must-revalidate",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "CDN-Cache-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      "X-Content-Type-Options": "nosniff",
      ...(downloadName
        ? { "Content-Disposition": `attachment; filename="${downloadName}"` }
        : {}),
    },
  });
}
function isManifest(
  value: unknown,
): value is { version: string; archive: string; sha256: string; size: number } {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    isReleaseVersion(item.version) &&
    item.archive === `latex-renderer-client-${item.version}.zip` &&
    typeof item.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(item.sha256) &&
    typeof item.size === "number" &&
    Number.isSafeInteger(item.size) &&
    item.size > 0
  );
}

function isReleaseVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-rc\.[1-9]\d*)?$/.test(
      value,
    )
  );
}
