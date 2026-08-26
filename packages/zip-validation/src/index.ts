import { constants } from "node:fs";
import { chmod, mkdir, open, realpath, rm } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import yauzl, { type Entry, type ZipFile } from "yauzl";
import { AppError } from "@latex-renderer/shared";

const allowedExtensions = new Set([
  ".tex",
  ".sty",
  ".cls",
  ".bib",
  ".csv",
  ".dat",
  ".txt",
  ".png",
  ".jpg",
  ".jpeg",
  ".pdf",
]);
const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export interface ZipLimits {
  maxExtractedBytes: number;
  maxFileBytes: number;
  maxEntries: number;
  maxFiles: number;
  maxDepth: number;
  maxNameLength: number;
}

export interface ExtractResult {
  files: number;
  bytes: number;
  paths: readonly string[];
}

export async function validateAndExtract(
  zipPath: string,
  destination: string,
  limits: ZipLimits,
  requestedEntrypoint = "main.tex",
): Promise<ExtractResult> {
  await mkdir(destination, { recursive: true, mode: 0o775 });
  await chmod(destination, 0o775);
  const root = await realpath(destination);
  const zip = await openZip(zipPath);
  const zipHandle = await open(zipPath, "r");
  const seen = new Set<string>();
  const paths: string[] = [];
  let entries = 0;
  let files = 0;
  let bytes = 0;
  const entrypoint =
    requestedEntrypoint === ""
      ? undefined
      : validateEntrypointPath(requestedEntrypoint, limits);
  let entrypointFound = false;
  let texFound = false;
  try {
    for (;;) {
      const entry = await nextEntry(zip);
      if (entry === null) break;
      entries += 1;
      if (entries > limits.maxEntries)
        throw new AppError(
          "ZIP_TOO_MANY_ENTRIES",
          "ZIP entry count exceeds limit",
          422,
        );
      await assertLocalHeader(zipHandle, entry);
      const normalized = normalizeEntry(entry.fileName, limits);
      const duplicateKey = normalized.normalize("NFC").toLowerCase();
      if (seen.has(duplicateKey))
        throw new AppError(
          "ZIP_DUPLICATE_PATH",
          "ZIP contains duplicate normalized paths",
          422,
        );
      seen.add(duplicateKey);
      assertEntryType(entry, normalized);
      if (normalized.endsWith("/")) continue;
      files += 1;
      if (files > limits.maxFiles)
        throw new AppError(
          "ZIP_TOO_MANY_FILES",
          "ZIP file count exceeds limit",
          422,
        );
      if (entry.uncompressedSize > limits.maxFileBytes)
        throw new AppError(
          "ZIP_FILE_TOO_LARGE",
          "ZIP entry exceeds per-file limit",
          422,
        );
      if (
        entry.uncompressedSize > 0 &&
        entry.compressedSize > 0 &&
        entry.uncompressedSize / entry.compressedSize > 10_000
      ) {
        throw new AppError(
          "ZIP_SUSPICIOUS_RATIO",
          "ZIP compression ratio is unsafe",
          422,
        );
      }
      const extension = extname(normalized).toLowerCase();
      if (!allowedExtensions.has(extension))
        throw new AppError(
          "ZIP_EXTENSION_REJECTED",
          `Extension is not allowed: ${extension}`,
          422,
        );
      if (normalized === entrypoint) entrypointFound = true;
      if (extension === ".tex") texFound = true;
      const target = resolve(root, normalized);
      if (!target.startsWith(`${root}${sep}`))
        throw new AppError("ZIP_SLIP", "ZIP path escapes extraction root", 422);
      await mkdir(dirname(target), { recursive: true, mode: 0o775 });
      await chmod(dirname(target), 0o775);
      const parent = await realpath(dirname(target));
      if (parent !== root && !parent.startsWith(`${root}${sep}`))
        throw new AppError(
          "ZIP_SYMLINK_ESCAPE",
          "ZIP parent escapes extraction root",
          422,
        );
      const input = await openEntry(zip, entry);
      let fileBytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          fileBytes += chunk.length;
          bytes += chunk.length;
          if (
            fileBytes > limits.maxFileBytes ||
            bytes > limits.maxExtractedBytes
          ) {
            callback(
              new AppError("ZIP_BOMB", "Extracted data exceeds limit", 422),
            );
          } else callback(null, chunk);
        },
      });
      const handle = await open(
        target,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o644,
      );
      await handle.chmod(0o644);
      const output = handle.createWriteStream({ autoClose: true });
      await pipeline(input, meter, output);
      if (fileBytes !== entry.uncompressedSize)
        throw new AppError(
          "ZIP_SIZE_MISMATCH",
          "ZIP entry size does not match header",
          422,
        );
      paths.push(normalized);
    }
    if (entrypoint !== undefined && !entrypointFound)
      throw new AppError(
        "ENTRYPOINT_MISSING",
        `ZIP does not contain the requested entrypoint: ${entrypoint}`,
        422,
      );
    if (entrypoint === undefined && !texFound)
      throw new AppError(
        "TEX_ENTRYPOINT_MISSING",
        "ZIP must contain at least one .tex file",
        422,
      );
    return { files, bytes, paths };
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    throw error;
  } finally {
    zip.close();
    await zipHandle.close();
  }
}

export function validateEntrypointPath(
  value: string,
  limits: Pick<ZipLimits, "maxDepth" | "maxNameLength"> = {
    maxDepth: 10,
    maxNameLength: 200,
  },
): string {
  if (value.endsWith("/") || value.includes("\\"))
    throw new AppError(
      "INVALID_ENTRYPOINT",
      "Entrypoint must be a relative POSIX .tex path",
      422,
    );
  const normalized = normalizeEntry(value, {
    ...limits,
    maxExtractedBytes: 1,
    maxFileBytes: 1,
    maxEntries: 1,
    maxFiles: 1,
  });
  if (extname(normalized).toLowerCase() !== ".tex")
    throw new AppError(
      "INVALID_ENTRYPOINT",
      "Entrypoint must end in .tex",
      422,
    );
  return normalized;
}

export function validateSourceFilePath(
  value: string,
  limits: Pick<ZipLimits, "maxDepth" | "maxNameLength"> = {
    maxDepth: 10,
    maxNameLength: 200,
  },
): string {
  if (value.endsWith("/"))
    throw new AppError(
      "INVALID_SOURCE_PATH",
      "Source path must name a file",
      422,
    );
  const normalized = normalizeEntry(value, {
    ...limits,
    maxExtractedBytes: 1,
    maxFileBytes: 1,
    maxEntries: 1,
    maxFiles: 1,
  });
  const extension = extname(normalized).toLowerCase();
  if (!allowedExtensions.has(extension))
    throw new AppError(
      "ZIP_EXTENSION_REJECTED",
      `Extension is not allowed: ${extension}`,
      422,
    );
  return normalized;
}

async function assertLocalHeader(
  handle: Awaited<ReturnType<typeof open>>,
  entry: Entry,
): Promise<void> {
  const fixed = Buffer.alloc(30);
  const fixedRead = await handle.read(
    fixed,
    0,
    fixed.length,
    entry.relativeOffsetOfLocalHeader,
  );
  if (
    fixedRead.bytesRead !== fixed.length ||
    fixed.readUInt32LE(0) !== 0x04034b50
  ) {
    throw new AppError(
      "ZIP_LOCAL_HEADER_INVALID",
      "ZIP local header is invalid",
      422,
    );
  }
  const flags = fixed.readUInt16LE(6);
  const method = fixed.readUInt16LE(8);
  const nameLength = fixed.readUInt16LE(26);
  const extraLength = fixed.readUInt16LE(28);
  if (
    flags !== entry.generalPurposeBitFlag ||
    method !== entry.compressionMethod ||
    nameLength > 4096 ||
    extraLength > 65_535
  ) {
    throw new AppError(
      "ZIP_HEADER_MISMATCH",
      "ZIP central and local headers do not match",
      422,
    );
  }
  const localName = Buffer.alloc(nameLength);
  const nameRead = await handle.read(
    localName,
    0,
    nameLength,
    entry.relativeOffsetOfLocalHeader + 30,
  );
  const expected = Buffer.from(entry.fileName, "utf8");
  const utf8 = (flags & 0x800) !== 0;
  if (
    nameRead.bytesRead !== nameLength ||
    (!utf8 && localName.some((value) => value > 0x7f)) ||
    !localName.equals(expected)
  ) {
    throw new AppError(
      "ZIP_HEADER_MISMATCH",
      "ZIP central and local file names do not match",
      422,
    );
  }
  if (
    (flags & 0x8) === 0 &&
    (fixed.readUInt32LE(18) !== entry.compressedSize ||
      fixed.readUInt32LE(22) !== entry.uncompressedSize)
  ) {
    throw new AppError(
      "ZIP_HEADER_MISMATCH",
      "ZIP central and local sizes do not match",
      422,
    );
  }
}

function normalizeEntry(name: string, limits: ZipLimits): string {
  // eslint-disable-next-line no-control-regex -- ZIP paths must reject every C0/DEL control byte.
  if (name.includes("\0") || /[\u0001-\u001f\u007f]/.test(name))
    throw new AppError(
      "ZIP_CONTROL_CHARACTER",
      "ZIP path contains control characters",
      422,
    );
  const replaced = name.replaceAll("\\", "/").normalize("NFC");
  if (
    replaced.startsWith("/") ||
    replaced.startsWith("//") ||
    /^[A-Za-z]:/.test(replaced)
  ) {
    throw new AppError(
      "ZIP_ABSOLUTE_PATH",
      "ZIP contains an absolute path",
      422,
    );
  }
  const directory = replaced.endsWith("/");
  const parts = replaced.split("/");
  if (directory) parts.pop();
  if (parts.length === 0 || parts.length > limits.maxDepth)
    throw new AppError("ZIP_DEPTH", "ZIP path depth is invalid", 422);
  for (const part of parts) {
    if (part.length === 0 || part === "." || part === "..")
      throw new AppError(
        "ZIP_DOT_PATH",
        "ZIP path has an unsafe component",
        422,
      );
    if (
      Array.from(part).length > limits.maxNameLength ||
      /[ .]$/.test(part) ||
      windowsReserved.test(part)
    ) {
      throw new AppError(
        "ZIP_UNSAFE_NAME",
        "ZIP path contains an unsafe file name",
        422,
      );
    }
  }
  return `${parts.join("/")}${directory ? "/" : ""}`;
}

function assertEntryType(entry: Entry, normalized: string): void {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0)
    throw new AppError(
      "ZIP_ENCRYPTED",
      "Encrypted ZIP entries are not allowed",
      422,
    );
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  const type = mode & 0o170000;
  const directory = normalized.endsWith("/");
  if (type === 0) return;
  if (directory && type === 0o040000) return;
  if (!directory && type === 0o100000) return;
  throw new AppError(
    "ZIP_SPECIAL_FILE",
    "Links and special files are not allowed",
    422,
  );
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, strictFileNames: true, validateEntrySizes: true },
      (error, zip) => {
        if (error !== null)
          reject(new AppError("INVALID_ZIP", "ZIP could not be opened", 422));
        else resolvePromise(zip);
      },
    );
  });
}

function nextEntry(zip: ZipFile): Promise<Entry | null> {
  return new Promise((resolvePromise, reject) => {
    const onEntry = (entry: Entry) => {
      cleanup();
      resolvePromise(entry);
    };
    const onEnd = () => {
      cleanup();
      resolvePromise(null);
    };
    const onError = () => {
      cleanup();
      reject(new AppError("INVALID_ZIP", "ZIP directory is invalid", 422));
    };
    const cleanup = () => {
      zip.off("entry", onEntry);
      zip.off("end", onEnd);
      zip.off("error", onError);
    };
    zip.once("entry", onEntry);
    zip.once("end", onEnd);
    zip.once("error", onError);
    zip.readEntry();
  });
}

function openEntry(zip: ZipFile, entry: Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolvePromise, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error !== null)
        reject(
          new AppError("INVALID_ZIP_ENTRY", "ZIP entry cannot be read", 422),
        );
      else resolvePromise(stream);
    });
  });
}
