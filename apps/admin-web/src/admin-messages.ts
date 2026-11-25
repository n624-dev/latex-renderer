import { createCatalogReader } from "./catalog.js";
import { english } from "./admin-english.js";

export const { read: adminCatalog, validate: validateAdminCatalogs } =
  createCatalogReader("admin", english);

export type AdminMessage = keyof typeof english;

export function adminLabels(locale: Parameters<typeof adminCatalog>[0]) {
  const catalog = adminCatalog(locale);
  return (key: AdminMessage): string => catalog[key];
}

export function createAdminMessage(catalog: ReturnType<typeof adminCatalog>) {
  return (
    key: AdminMessage,
    values: Readonly<Record<string, string | number>> = {},
  ): string =>
    catalog[key].replaceAll(
      /\{([a-zA-Z][a-zA-Z0-9]*)\}/g,
      (match, name: string) =>
        Object.hasOwn(values, name) ? String(values[name]) : match,
    );
}
