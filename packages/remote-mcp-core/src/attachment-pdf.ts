import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { AppError } from "@latex-renderer/shared";

export async function validateUploadedPdf(path: string, maxBytes: number) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size < 5 ||
      info.size > maxBytes
    )
      throw new AppError(
        "PDF_UPLOAD_INVALID",
        "The attachment is not a supported PDF",
        400,
      );
    const prefix = Buffer.alloc(5);
    const { bytesRead } = await handle.read(prefix, 0, prefix.length, 0);
    if (bytesRead !== prefix.length || prefix.toString("ascii") !== "%PDF-")
      throw new AppError(
        "PDF_UPLOAD_INVALID",
        "The attachment does not have a PDF header",
        400,
      );
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({
      start: 0,
      end: info.size - 1,
      autoClose: false,
    }))
      hash.update(chunk as Buffer);
    return { size: info.size, sha256: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export async function readUploadedPdfInspection(
  path: string,
): Promise<unknown> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size > 65_536)
      throw new AppError(
        "PDF_INSPECTION_UNAVAILABLE",
        "The PDF inspection report is unavailable",
        410,
      );
    return JSON.parse(await handle.readFile("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}
