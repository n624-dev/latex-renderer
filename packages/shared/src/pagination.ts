import { AppError } from "./index.js";

/**
 * Opaque, bounded cursors used by all list endpoints.
 *
 * Cursors intentionally contain only the last row's immutable sort values;
 * they are not offsets, so inserts/deletes between requests do not cause rows
 * to be skipped or repeated.
 */
export type PageCursor<Key extends string = string> = Readonly<
  Record<Key, string>
>;

export function encodePageCursor(value: PageCursor): string {
  if (
    Object.keys(value).length === 0 ||
    Object.keys(value).some(
      (key) =>
        !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(key) ||
        typeof value[key] !== "string" ||
        value[key].length > 256,
    )
  )
    throw new AppError("INVALID_CURSOR", "Cursor values are invalid", 500);
  return Buffer.from(JSON.stringify({ v: 1, ...value }), "utf8").toString(
    "base64url",
  );
}

export function decodePageCursor<const Key extends string>(
  value: string | undefined,
  keys: readonly Key[],
): PageCursor<Key> | undefined {
  if (value === undefined || value === "") return undefined;
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new AppError("INVALID_CURSOR", "Cursor is invalid", 400);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new AppError("INVALID_CURSOR", "Cursor is invalid", 400);
  }
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    (parsed as { v?: unknown }).v !== 1
  )
    throw new AppError("INVALID_CURSOR", "Cursor is invalid", 400);
  const object = parsed as Record<string, unknown>;
  const expected: ReadonlySet<string> = new Set(keys);
  if (
    Object.keys(object).some((key) => key !== "v" && !expected.has(key)) ||
    keys.some((key) => typeof object[key] !== "string")
  )
    throw new AppError("INVALID_CURSOR", "Cursor is invalid", 400);
  return Object.fromEntries(
    keys.map((key) => [key, object[key] as string]),
  ) as PageCursor<Key>;
}

export function pageSize(
  value: string | number | undefined,
  options: { defaultSize?: number; maxSize?: number } = {},
): number {
  const defaultSize = options.defaultSize ?? 50;
  const maxSize = options.maxSize ?? 100;
  const parsed = value === undefined ? defaultSize : Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maxSize ||
    (typeof value === "string" && !/^\d+$/.test(value))
  )
    throw new AppError(
      "INVALID_PAGE_SIZE",
      `pageSize must be an integer between 1 and ${maxSize}`,
      400,
    );
  return parsed;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  /** Optional exact count, populated by administrative list endpoints. */
  total?: number;
}
