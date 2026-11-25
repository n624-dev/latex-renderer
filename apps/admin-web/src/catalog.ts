import { readFileSync } from "node:fs";
import {
  displayLocales,
  type DisplayLocale,
} from "@latex-renderer/shared/locale";

export function createCatalogReader<Key extends string>(
  namespace: "site" | "app" | "admin",
  english: Readonly<Record<Key, string>>,
) {
  type Catalog = Readonly<Record<Key, string>>;
  const keys = Object.keys(english) as Key[];
  let cached: { locale: DisplayLocale; catalog: Catalog } | undefined;
  const source = (locale: DisplayLocale) =>
    new URL(`../locales/${namespace}/${locale}.json`, import.meta.url);

  function read(locale: DisplayLocale): Catalog {
    if (locale === "en") return english;
    if (cached?.locale === locale) return cached.catalog;
    const parsed = JSON.parse(
      readFileSync(source(locale), "utf8"),
    ) as Partial<Catalog>;
    const catalog: Record<Key, string> = { ...english };
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value === "string" && value.length > 0) catalog[key] = value;
    }
    cached = { locale, catalog };
    return catalog;
  }

  function validate(): string[] {
    const problems: string[] = [];
    const slots = (value: string) =>
      [...value.matchAll(/\{[a-zA-Z][a-zA-Z0-9]*\}/g)]
        .map((match) => match[0])
        .sort()
        .join(",");
    for (const locale of displayLocales) {
      if (locale === "en") continue;
      const catalog = JSON.parse(
        readFileSync(source(locale), "utf8"),
      ) as Record<string, unknown>;
      for (const key of keys) {
        const value = catalog[key];
        if (typeof value !== "string" || value.trim().length === 0)
          problems.push(`${locale}: missing ${namespace} message ${key}`);
        else if (slots(value) !== slots(english[key]))
          problems.push(
            `${locale}: invalid placeholders for ${namespace} message ${key}`,
          );
      }
      for (const key of Object.keys(catalog))
        if (!Object.hasOwn(english, key))
          problems.push(`${locale}: unknown ${namespace} message ${key}`);
    }
    return problems;
  }

  return { read, validate };
}
