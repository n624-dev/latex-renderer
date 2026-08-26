import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { AppError } from "@latex-renderer/shared";
import { SaxesParser } from "saxes";
import type { WorkerConfig } from "./config.js";

export interface ValidatedArtifact {
  path: string;
  type: string;
  size: number;
  sha256: string;
}

export async function validateArtifacts(
  config: WorkerConfig,
  directory: string,
  requirePdf: boolean,
  requireSvg = false,
): Promise<ValidatedArtifact[]> {
  const files = await walk(directory),
    result: ValidatedArtifact[] = [];
  let total = 0,
    previewTotal = 0,
    svgTotal = 0;
  for (const file of files) {
    const path = relative(directory, file),
      info = await lstat(file);
    if (!info.isFile() || info.nlink !== 1)
      throw new AppError(
        "UNSAFE_ARTIFACT",
        "Renderer emitted a non-regular artifact",
      );
    const type = artifactType(path);
    if (type === undefined) continue;
    total += info.size;
    if (type === "preview") previewTotal += info.size;
    if (type === "svg" || type === "svg_manifest") svgTotal += info.size;
    if (
      total > config.maxOutputBytes ||
      (type === "log" && info.size > config.maxLogBytes) ||
      (type === "pdf" && info.size > 100 * 1024 * 1024) ||
      (type === "svg" && info.size > config.maxSvgBytes) ||
      previewTotal > 150 * 1024 * 1024 ||
      svgTotal > config.maxSvgTotalBytes
    )
      throw new AppError("OUTPUT_LIMIT", "Renderer output exceeds limit");
    const prefix = await readPrefix(file, 8);
    if (type === "pdf" && prefix.subarray(0, 5).toString("ascii") !== "%PDF-")
      throw new AppError("PDF_MAGIC_INVALID", "result.pdf is not a PDF");
    if (
      type === "preview" &&
      !prefix.equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    )
      throw new AppError("PNG_MAGIC_INVALID", "Preview is not a PNG");
    if (type === "errors" || type === "dependencies")
      JSON.parse(await readFile(file, "utf8"));
    if (type === "svg") validateSvg(await readFile(file, "utf8"));
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(file))
      hash.update(chunk as Buffer);
    result.push({
      path,
      type,
      size: info.size,
      sha256: hash.digest("hex"),
    });
  }
  if (requirePdf && !result.some((item) => item.type === "pdf"))
    throw new AppError("PDF_MISSING", "Renderer did not emit result.pdf");
  if (requireSvg) await validateSvgSet(config, directory, result);
  if (
    !result.some((item) => item.type === "log") ||
    !result.some((item) => item.type === "errors")
  )
    throw new AppError(
      "DIAGNOSTICS_MISSING",
      "Renderer diagnostics are missing",
    );
  return result;
}

function artifactType(path: string): string | undefined {
  if (path === "result.pdf") return "pdf";
  if (path === "compile.log") return "log";
  if (path === "errors.json") return "errors";
  if (path === "dependencies.json") return "dependencies";
  if (path === "svg/manifest.json") return "svg_manifest";
  if (/^svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg$/.test(path)) return "svg";
  if (/^previews\/page-[0-9]+\.png$/.test(path)) return "preview";
  return undefined;
}

export async function publishArtifacts(
  source: string,
  destination: string,
  artifacts: readonly ValidatedArtifact[],
): Promise<void> {
  await mkdir(destination, { recursive: true, mode: 0o770 });
  for (const artifact of artifacts) {
    const target = join(destination, artifact.path);
    await mkdir(dirname(target), { recursive: true, mode: 0o770 });
    await copyFile(join(source, artifact.path), target);
  }
}

export async function directorySize(directory: string): Promise<number> {
  try {
    return (
      await Promise.all(
        (await walk(directory)).map(async (file) => (await lstat(file)).size),
      )
    ).reduce((left, right) => left + right, 0);
  } catch {
    return 0;
  }
}

function validateSvg(value: string): void {
  const state = { root: false },
    forbidden = new Set([
      "script",
      "foreignobject",
      "iframe",
      "object",
      "embed",
      "audio",
      "video",
      "style",
      "text",
    ]),
    parser = new SaxesParser<{ xmlns: true }>({ xmlns: true });
  parser.on("doctype", () => {
    throw new AppError("SVG_UNSAFE", "SVG document types are forbidden");
  });
  parser.on("processinginstruction", () => {
    throw new AppError(
      "SVG_UNSAFE",
      "SVG processing instructions are forbidden",
    );
  });
  parser.on("opentag", (tag) => {
    const local = tag.local.toLowerCase();
    if (!state.root) {
      if (local !== "svg")
        throw new AppError("SVG_INVALID", "SVG root element is missing");
      state.root = true;
    }
    if (forbidden.has(local))
      throw new AppError("SVG_UNSAFE", `SVG element is forbidden: ${local}`);
    for (const attribute of Object.values(tag.attributes)) {
      const name = attribute.local.toLowerCase(),
        raw = attribute.value,
        normalized = raw.trim().toLowerCase(),
        safeReference =
          normalized.startsWith("#") ||
          /^data:image\/(?:png|jpeg|gif|webp);base64,/.test(normalized);
      if (name.startsWith("on"))
        throw new AppError("SVG_UNSAFE", "SVG event attributes are forbidden");
      if (
        name === "href" &&
        !safeReference
      )
        throw new AppError(
          "SVG_UNSAFE",
          "SVG external references are forbidden",
        );
      if (
        name !== "xmlns" &&
        name !== "xlink" &&
        (normalized.includes("javascript:") ||
          normalized.includes("@import") ||
          /url\(\s*(?!['"]?#)/i.test(raw))
      )
        throw new AppError(
          "SVG_UNSAFE",
          "SVG active or external content is forbidden",
        );
    }
  });
  try {
    parser.write(value).close();
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("SVG_INVALID", "SVG is not well-formed XML");
  }
  if (!state.root)
    throw new AppError("SVG_INVALID", "SVG root element is missing");
}

async function validateSvgSet(
  config: WorkerConfig,
  directory: string,
  artifacts: readonly ValidatedArtifact[],
): Promise<void> {
  const manifestArtifact = artifacts.find(
      (item) => item.type === "svg_manifest",
    ),
    svgArtifacts = artifacts.filter((item) => item.type === "svg");
  if (manifestArtifact === undefined)
    throw new AppError(
      "SVG_MANIFEST_MISSING",
      "Renderer did not emit svg/manifest.json",
    );
  if (svgArtifacts.length > config.maxSvgObjects)
    throw new AppError(
      "SVG_OBJECT_LIMIT",
      "Renderer emitted too many SVG objects",
    );
  let value: unknown;
  try {
    value = JSON.parse(
      await readFile(join(directory, manifestArtifact.path), "utf8"),
    );
  } catch {
    throw new AppError("SVG_MANIFEST_INVALID", "SVG manifest is invalid JSON");
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { objects?: unknown }).objects)
  )
    throw new AppError(
      "SVG_MANIFEST_INVALID",
      "SVG manifest has an invalid shape",
    );
  const manifest = value as {
    schemaVersion?: unknown;
    coordinateSystem?: unknown;
    objects: unknown[];
  };
  const coordinates = manifest.coordinateSystem,
    coordinateValues =
      typeof coordinates === "object" && coordinates !== null
        ? (coordinates as Record<string, unknown>)
        : undefined,
    coordinatesValid =
      coordinateValues !== undefined &&
      coordinateValues.unit === "pdf-point" &&
      coordinateValues.origin === "top-left" &&
      coordinateValues.xAxis === "right" &&
      coordinateValues.yAxis === "down";
  if (
    manifest.schemaVersion !== 1 ||
    !coordinatesValid ||
    manifest.objects.length !== svgArtifacts.length
  )
    throw new AppError(
      "SVG_COUNT_MISMATCH",
      "SVG manifest and artifact counts differ",
    );
  const expected = new Set(svgArtifacts.map((item) => item.path));
  for (const [index, object] of manifest.objects.entries()) {
    if (typeof object !== "object" || object === null)
      throw new AppError(
        "SVG_MANIFEST_INVALID",
        "SVG manifest object is invalid",
      );
    const item = object as Record<string, unknown>,
      sequence = index + 1,
      expectedId = String(sequence).padStart(6, "0"),
      numericCoordinates = ["x", "y", "width", "height"] as const;
    if (
      (item.kind !== "math" && item.kind !== "tikz") ||
      item.id !== sequence ||
      typeof item.artifact !== "string" ||
      item.artifact !== `svg/objects/${item.kind}-${expectedId}.svg` ||
      !expected.delete(item.artifact) ||
      typeof item.sourceFile !== "string" ||
      item.sourceFile.startsWith("/") ||
      item.sourceFile.split("/").includes("..") ||
      !Number.isSafeInteger(item.sourceLine) ||
      Number(item.sourceLine) < 1 ||
      !Number.isSafeInteger(item.page) ||
      Number(item.page) < 1 ||
      !numericCoordinates.every(
        (key) =>
          typeof item[key] === "number" && Number.isFinite(item[key]),
      ) ||
      Number(item.width) <= 0 ||
      Number(item.height) <= 0
    )
      throw new AppError(
        "SVG_MANIFEST_INVALID",
        "SVG manifest object is invalid",
      );
  }
  if (expected.size !== 0)
    throw new AppError(
      "SVG_COUNT_MISMATCH",
      "SVG manifest does not cover every artifact",
    );
}

async function readPrefix(path: string, length: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length),
      result = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}
