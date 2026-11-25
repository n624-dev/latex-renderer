import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { Readable } from "node:stream";

const assetPattern =
  /^(?:editor\.js|styles\.css|locales\/[a-z]{2}(?:-[A-Z]{2})?\.js|pdf\/(?:pdf(?:\.worker)?\.mjs|(?:cmaps|standard_fonts|iccs|wasm)\/[A-Za-z0-9_.-]+\.(?:bcmap|pfb|ttf|icc|wasm|mjs)|wasm\/(?:jbig2|openjpeg)_nowasm_fallback\.js))$/;
const assetDirectory = new URL("../dist/editor-assets/", import.meta.url);

export function readEditorAssetVersion(): string | undefined {
  try {
    const version = readFileSync(
      new URL("version.txt", assetDirectory),
      "utf8",
    ).trim();
    if (!/^[a-f0-9]{64}$/.test(version))
      throw new Error("Invalid editor asset version");
    return version;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return;
    throw error;
  }
}

export async function editorAsset(
  path: string,
  encodings?: string,
): Promise<Response> {
  if (!assetPattern.test(path)) return new Response(null, { status: 404 });
  const scripts =
    path === "editor.js" ||
    path.startsWith("locales/") ||
    path === "pdf/pdf.mjs" ||
    path === "pdf/pdf.worker.mjs";
  const compressed =
    scripts &&
    /(?:^|,)\s*gzip\s*(?:;\s*q=(?:1(?:\.0{1,3})?|0\.\d{0,2}[1-9]\d*))?\s*(?:,|$)/i.test(
      encodings ?? "",
    );
  const asset = new URL(path + (compressed ? ".gz" : ""), assetDirectory);
  const file = await stat(asset).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (!file?.isFile()) return new Response(null, { status: 404 });
  const name = basename(path);
  const type = /\.m?js$/.test(name)
    ? "text/javascript; charset=utf-8"
    : name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : name.endsWith(".wasm")
        ? "application/wasm"
        : "application/octet-stream";
  return new Response(
    Readable.toWeb(createReadStream(asset)) as ReadableStream<Uint8Array>,
    {
      headers: {
        "Content-Type": type,
        "Content-Length": String(file.size),
        ...(scripts ? { Vary: "Accept-Encoding" } : {}),
        ...(compressed ? { "Content-Encoding": "gzip" } : {}),
      },
    },
  );
}
