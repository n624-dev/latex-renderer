import type { PdfSheetQuery } from "@latex-renderer/contracts";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AppError, sha256Hex } from "@latex-renderer/shared";

// Invocation order defines reading order in the sheet. Source text, PDF
// metadata and filenames are never interpolated into the renderer program.
export const sheetProgram = String.raw`
umask 0007
export LC_ALL=C.UTF-8
cd /work/output
i=0
for page in "$@"; do
  i=$((i+1))
  timeout -k 2 5 pdftoppm -f "$page" -l "$page" -cropbox -scale-to 252 -singlefile -png /work/pdf/result.pdf "/tmp/tile-$i"
  [ -s "/tmp/tile-$i.png" ]
done
timeout -k 2 8 montage /tmp/tile-*.png -tile 2x -geometry 252x252+4+4 -background white -quality 76 sheet.jpg
if [ "$(wc -c < sheet.jpg)" -gt 40000 ]; then
  timeout -k 2 6 convert sheet.jpg -resize 420x420\> -quality 67 reduced.jpg
  mv reduced.jpg sheet.jpg
fi
`;

export async function readPdfSheet(directory: string, query: PdfSheetQuery) {
  const path = join(directory, "sheet.jpg");
  const info = await lstat(path);
  if (!info.isFile() || info.nlink !== 1 || info.size > 40_000)
    throw new AppError(
      "PDF_SHEET_OUTPUT_LIMIT",
      "Contact sheet exceeds the inline image limit",
      409,
    );
  const bytes = await readFile(path);
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8)
    throw new Error("Invalid PDF contact sheet");
  return {
    pages: query.pages,
    columns: Math.min(2, query.pages.length),
    mimeType: "image/jpeg" as const,
    sha256: sha256Hex(bytes),
    base64: bytes.toString("base64"),
  };
}
