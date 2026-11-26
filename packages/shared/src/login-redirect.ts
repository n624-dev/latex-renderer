const returnOrigin = "https://return.invalid";

export function safeLoginReturnTo(value: string): string {
  if (
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return "/app/";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return "/app/";
  }
  const url = new URL(value, returnOrigin);
  if (url.origin !== returnOrigin || url.pathname.startsWith("//"))
    return "/app/";
  return `${url.pathname}${url.search}${url.hash}`;
}
