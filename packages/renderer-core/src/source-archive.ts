import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { AppError } from "@latex-renderer/shared";
import {
  validateSourceFilePath,
  type ZipLimits,
} from "@latex-renderer/zip-validation";
import yazl from "yazl";

export type SourceZipLimits = ZipLimits & { maxArchiveBytes: number };

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>)
    hash.update(chunk);
  return hash.digest("hex");
}

export async function zipFiles(
  files: readonly {
    path: string;
    bytes?: Buffer | undefined;
    absolutePath?: string | undefined;
    size?: number | undefined;
  }[],
  limits: SourceZipLimits,
): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  addZipFiles(zip, files, limits);
  const chunks: Buffer[] = [];
  const output = zip.outputStream as Readable;
  zip.on("error", (error: Error) => output.destroy(error));
  const completed = pipeline(
    output,
    boundedArchiveStream(limits.maxArchiveBytes),
    new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk);
        done();
      },
    }),
  );
  zip.end();
  await completed;
  await assertZipInputsUnchanged(files);
  return Buffer.concat(chunks);
}

/** Build a revision ZIP on disk, bounded by configured archive limits. */
export async function writeZipFiles(
  files: readonly {
    path: string;
    bytes?: Buffer | undefined;
    absolutePath?: string | undefined;
    size?: number | undefined;
  }[],
  destination: string,
  limits: SourceZipLimits,
): Promise<void> {
  const zip = new yazl.ZipFile();
  const outputStream = zip.outputStream as Readable;
  addZipFiles(zip, files, limits);
  const handle = await open(destination, "wx", 0o660);
  zip.on("error", (error: Error) => outputStream.destroy(error));
  const completed = pipeline(
    outputStream,
    boundedArchiveStream(limits.maxArchiveBytes),
    handle.createWriteStream(),
  );
  try {
    zip.end();
    await completed;
    await assertZipInputsUnchanged(files);
  } catch (error) {
    outputStream.destroy();
    await completed.catch(() => {});
    await rm(destination, { force: true });
    throw error;
  } finally {
    await handle.close();
  }
}

export function boundedArchiveStream(maximum: number) {
  let totalBytes = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      totalBytes += chunk.byteLength;
      if (totalBytes > maximum) {
        callback(
          new AppError(
            "SOURCE_ARCHIVE_SIZE",
            `Source archive exceeds the configured ${maximum}-byte upload limit`,
            422,
          ),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

function addZipFiles(
  zip: yazl.ZipFile,
  files: readonly {
    path: string;
    bytes?: Buffer | undefined;
    absolutePath?: string | undefined;
    size?: number | undefined;
  }[],
  limits: SourceZipLimits,
): void {
  if (files.length > Math.min(limits.maxFiles, limits.maxEntries))
    throw new AppError(
      "ZIP_TOO_MANY_FILES",
      "Source archive exceeds the configured entry count",
      422,
    );
  let totalBytes = 0;
  for (const file of files) {
    const size = file.bytes?.byteLength ?? file.size ?? -1;
    if (!Number.isSafeInteger(size) || size < 0)
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Source file size is invalid",
        422,
      );
    if (size > limits.maxFileBytes)
      throw new AppError(
        "ZIP_FILE_TOO_LARGE",
        "Source file exceeds limit",
        422,
      );
    totalBytes += size;
    if (totalBytes > limits.maxExtractedBytes)
      throw new AppError("ZIP_BOMB", "Source content exceeds limit", 422);
  }
  for (const file of [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  )) {
    if (file.bytes !== undefined)
      zip.addBuffer(file.bytes, file.path, {
        mode: 0o600,
        mtime: new Date(0),
      });
    else if (file.absolutePath !== undefined) {
      const size = file.size;
      if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0)
        throw new AppError(
          "SOURCE_FILE_SIZE",
          "Source file size is invalid",
          422,
        );
      zip.addReadStreamLazy(
        file.path,
        {
          mode: 0o600,
          mtime: new Date(0),
          // Bound the stream to the size checked by readDirectoryFiles.  A
          // file that grows while the archive is being built cannot make the
          // archive exceed the extracted-byte limit.
          size,
        },
        (callback) => {
          if (size === 0) {
            callback(null, Readable.from([]));
            return;
          }
          callback(
            null,
            createReadStream(file.absolutePath as string, {
              start: 0,
              end: size - 1,
            }),
          );
        },
      );
    } else throw new Error(`Source file has no readable content: ${file.path}`);
  }
}

async function assertZipInputsUnchanged(
  files: readonly {
    absolutePath?: string | undefined;
    size?: number | undefined;
  }[],
): Promise<void> {
  for (const file of files) {
    if (file.absolutePath === undefined) continue;
    const metadata = await stat(file.absolutePath);
    if (!metadata.isFile() || metadata.size !== file.size)
      throw new AppError(
        "SOURCE_FILE_CHANGED",
        "Source changed while its revision was being archived",
        409,
      );
  }
}

export async function readDirectoryFiles(
  root: string,
  relative: string,
  state: {
    files: number;
    bytes: number;
    maxFiles: number;
    maxBytes: number;
    maxFileBytes: number;
  },
): Promise<Array<{ path: string; absolutePath: string; size: number }>> {
  const directory = join(root, ...relative.split("/").filter(Boolean)),
    entries = await readdir(directory, { withFileTypes: true }),
    files: Array<{ path: string; absolutePath: string; size: number }> = [];
  for (const entry of entries) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory())
      files.push(...(await readDirectoryFiles(root, path, state)));
    else if (entry.isFile()) {
      const absolutePath = join(root, ...path.split("/")),
        metadata = await stat(absolutePath);
      if (!metadata.isFile())
        throw new AppError(
          "SOURCE_FILE_TYPE",
          "Source contains an unsupported file type",
          422,
        );
      if (!Number.isSafeInteger(metadata.size) || metadata.size < 0)
        throw new AppError(
          "SOURCE_FILE_SIZE",
          "Source file size is invalid",
          422,
        );
      state.files += 1;
      if (state.files > state.maxFiles)
        throw new AppError(
          "ZIP_TOO_MANY_FILES",
          "Source file count exceeds limit",
          422,
        );
      if (metadata.size > state.maxFileBytes)
        throw new AppError(
          "ZIP_FILE_TOO_LARGE",
          "Source file exceeds limit",
          422,
        );
      state.bytes += metadata.size;
      if (state.bytes > state.maxBytes)
        throw new AppError("ZIP_BOMB", "Source content exceeds limit", 422);
      files.push({
        path: validateSourceFilePath(path),
        absolutePath,
        size: metadata.size,
      });
    } else
      throw new AppError(
        "SOURCE_FILE_TYPE",
        "Source contains an unsupported file type",
        422,
      );
  }
  return files;
}
