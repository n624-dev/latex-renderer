import { createReadStream, readFileSync } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

const directory = new URL("../../font-assets/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("manifest.json", directory), "utf8"),
) as {
  stylesheet: string;
  regional: Record<"ja" | "zh-CN" | "ko", string>;
  fonts: string[];
};
const prefix = "/assets/fonts/";
const licensedFiles = ["Inter-OFL.txt", "Noto-OFL.txt"];
const names = new Set([
  manifest.stylesheet,
  ...Object.values(manifest.regional),
  ...manifest.fonts,
  ...licensedFiles,
]);

export const fontStylesheet = prefix + manifest.stylesheet;
export const regionalFontStylesheets = {
  ja: prefix + manifest.regional.ja,
  "zh-CN": prefix + manifest.regional["zh-CN"],
  ko: prefix + manifest.regional.ko,
};
export const publicWebFontFiles = [...names].map((name) => ({
  path: prefix.slice(1) + name,
  source: new URL(name, directory),
}));

export function isVersionedWebFont(path: string): boolean {
  return (
    path.startsWith(prefix) &&
    names.has(path.slice(prefix.length)) &&
    /\.[a-f0-9]{16}\.(?:woff2|css)$/.test(path)
  );
}

export async function webFontAsset(
  name: string,
): Promise<Response | undefined> {
  if (!names.has(name)) return;
  const source = new URL(name, directory);
  const file = await stat(source).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return undefined;
    throw error;
  });
  if (!file?.isFile()) return;
  const contentType = name.endsWith(".woff2")
    ? "font/woff2"
    : name.endsWith(".css")
      ? "text/css; charset=utf-8"
      : "text/plain; charset=utf-8";
  return new Response(
    Readable.toWeb(createReadStream(source)) as ReadableStream<Uint8Array>,
    {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.size),
      },
    },
  );
}
