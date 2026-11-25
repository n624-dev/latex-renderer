import type { DisplayLocale } from "@latex-renderer/shared/locale";
import { createCatalogReader } from "./catalog.js";
import { english } from "./app-english.js";

export type AppMessage = keyof typeof english;
export const { read: appCatalog, validate: validateAppCatalogs } =
  createCatalogReader("app", english);

export function appLabels(locale: DisplayLocale) {
  const catalog = appCatalog(locale);
  return (key: AppMessage): string => catalog[key];
}
