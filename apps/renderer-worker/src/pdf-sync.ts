import type { PdfSyncQuery } from "@latex-renderer/contracts";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

export const syncProgram = String.raw`
umask 0007
export LC_ALL=C.UTF-8
cd /work/input
case "$1" in
  pdf_to_source) timeout -k 2 10 synctex edit -o "$2:/work/pdf/result.pdf" ;;
  source_to_pdf)
    # The CLI can fall back to a basename. First require the selected exact
    # relative path in the map, so a similarly named file cannot stand in.
    recorded=$(timeout -k 1 4 gzip -cd /work/pdf/result.synctex.gz |
      head -c 4194304 |
      awk -v path="$3" '
        /^Input:[0-9]+:/ {
          sub(/^Input:[0-9]+:/, "");
          if ($0==path || $0=="./" path || $0=="/work/input/" path) {
            print; exit;
          }
        }
      ')
    if [ -n "$recorded" ]; then
      timeout -k 2 10 synctex view -i "$2:0:$recorded" -o /work/pdf/result.pdf
    fi
    ;;
  *) exit 64 ;;
esac > /work/output/source-map-result
`;

export function syncArguments(query: PdfSyncQuery): string[] {
  return query.direction === "pdf_to_source"
    ? [
        query.direction,
        `${query.page}:${query.x.toFixed(5)}:${query.y.toFixed(5)}`,
      ]
    : [query.direction, String(query.line), query.path];
}

export async function readSyncResult(
  directory: string,
  query: PdfSyncQuery,
  allowedPaths: ReadonlySet<string>,
) {
  const path = join(directory, "source-map-result");
  const stat = await lstat(path);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32_768)
    throw new Error("Invalid SyncTeX response");
  return parseSyncResult(await readFile(path, "utf8"), query, allowedPaths);
}

export function parseSyncResult(
  text: string,
  query: PdfSyncQuery,
  allowedPaths: ReadonlySet<string>,
) {
  const match =
    /^SyncTeX result begin\r?\n([\s\S]*?)^SyncTeX result end\r?$/m.exec(text);
  const rows = match?.[1]?.split(/^Output:[^\n]*\n/m).slice(1) ?? [];
  const sources: Array<{ path: string; line: number; column: number | null }> =
    [];
  const locations: Array<{ page: number; x: number; y: number }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const value = (key: string) =>
      row
        .split(/\r?\n/)
        .find((line) => line.startsWith(key + ":"))
        ?.slice(key.length + 1);
    if (query.direction === "pdf_to_source") {
      const path = value("Input")?.replace(/^(?:\/work\/input\/|\.\/)/, "");
      const line = numeric(value("Line"));
      const column = numeric(value("Column"));
      if (
        path === undefined ||
        !allowedPaths.has(path) ||
        !Number.isSafeInteger(line) ||
        line < 1
      )
        continue;
      const item = {
        path,
        line,
        column: Number.isSafeInteger(column) && column > 0 ? column : null,
      };
      const key = JSON.stringify(item);
      if (!seen.has(key)) sources.push(item);
      seen.add(key);
    } else {
      const page = numeric(value("Page")),
        x = numeric(value("x")),
        y = numeric(value("y"));
      if (
        !Number.isSafeInteger(page) ||
        page < 1 ||
        page > 100 ||
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < 0 ||
        y < 0 ||
        x > 12000 ||
        y > 12000
      )
        continue;
      const item = { page, x, y };
      const key = JSON.stringify(item);
      if (!seen.has(key)) locations.push(item);
      seen.add(key);
    }
  }
  return {
    evidence: "canonical_synctex" as const,
    state: seen.size > 0 ? ("candidate" as const) : ("unknown" as const),
    coordinateSystem: "unrotated_page_points_top_left" as const,
    sources: sources.slice(0, 16),
    locations: locations.slice(0, 16),
    truncated: seen.size > 16,
  };
}

function numeric(value: string | undefined): number {
  if (value === undefined || !/^-?\d+(?:\.\d+)?$/.test(value)) return NaN;
  return Number(value);
}
