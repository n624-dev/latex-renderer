import type { DisplayLocale } from "@latex-renderer/shared/locale";
import { createCatalogReader } from "./catalog.js";
import { english } from "./site-english.js";

type SiteMessage = keyof typeof english;
type Slots<Message> = Message extends `${string}{${infer Name}}${infer Rest}`
  ? Name | Slots<Rest>
  : never;
type Values<Key extends SiteMessage> = Record<
  Slots<(typeof english)[Key]>,
  string
>;
type Arguments<Key extends SiteMessage> = [
  Slots<(typeof english)[Key]>,
] extends [never]
  ? []
  : [values: Values<Key>];

const { read: siteCatalog, validate: validateSiteCatalogs } =
  createCatalogReader("site", english);
const placeholder = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;
export { siteCatalog, validateSiteCatalogs };

export function siteText(
  locale: DisplayLocale,
  renderText: (text: string) => string = (text) => text,
) {
  const catalog = siteCatalog(locale);
  return <Key extends SiteMessage>(
    key: Key,
    ...args: Arguments<Key>
  ): string => {
    const values: Readonly<Record<string, string>> = args[0] ?? {};
    return catalog[key]
      .split(placeholder)
      .map((part, index) =>
        index % 2 === 1 && Object.hasOwn(values, part)
          ? (values[part] ?? "")
          : renderText(index % 2 === 1 ? `{${part}}` : part),
      )
      .join("");
  };
}

export function languageName(locale: DisplayLocale): string {
  return (
    new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale
  );
}
