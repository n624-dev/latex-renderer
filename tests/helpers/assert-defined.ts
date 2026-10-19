/** Keep fixture assumptions executable instead of erasing nullability. */
export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing fixture value");
  return value;
}
