import { readFileSync } from "node:fs";
import type { DisplayLocale } from "@latex-renderer/shared/locale";

import {
  interpolateRendererMcpText,
  rendererMcpEnglishMessages,
  type RendererMcpMessage,
  type RendererMcpTranslate,
} from "@latex-renderer/contracts/renderer-mcp-messages";

type Catalog = Readonly<Record<RendererMcpMessage, string>>;
let cached: { locale: DisplayLocale; catalog: Catalog } | undefined;
function catalog(locale: DisplayLocale): Catalog {
  if (locale === "en") return rendererMcpEnglishMessages;
  if (cached?.locale !== locale) {
    const file = new URL(`../locales/${locale}.json`, import.meta.url);
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<Catalog>;
    cached = { locale, catalog: { ...rendererMcpEnglishMessages, ...parsed } };
  }
  return cached.catalog;
}

export function mcpText(
  locale: DisplayLocale,
  ...[key, values = {}]: Parameters<RendererMcpTranslate>
): string {
  return interpolateRendererMcpText(catalog(locale)[key], values);
}
