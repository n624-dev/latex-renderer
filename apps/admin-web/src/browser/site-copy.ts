import type { english } from "../site-english.js";

export function siteCopy() {
  const metadata = document.querySelector<HTMLMetaElement>(
    'meta[name="site-messages"]',
  );
  let messages: unknown;
  try {
    messages = JSON.parse(metadata?.content || "{}");
  } catch {
    messages = undefined;
  }
  return (key: keyof typeof english, fallback: string): string => {
    if (typeof messages !== "object" || messages === null) return fallback;
    const label = (messages as Record<string, unknown>)[key];
    return typeof label === "string" ? label : fallback;
  };
}
