export const displayLocales = [
  "en",
  "ja",
  "zh-CN",
  "ko",
  "es",
  "pt",
  "fr",
  "de",
  "it",
  "ru",
  "tr",
  "pl",
  "cs",
  "nl",
  "sv",
  "no",
  "da",
  "fi",
] as const;

export type DisplayLocale = (typeof displayLocales)[number];

const localeByTag: ReadonlyMap<string, DisplayLocale> = new Map(
  displayLocales.map((locale) => [locale, locale]),
);

/** Resolve a BCP 47 tag using the locales with a supported dictionary. */
export function matchDisplayLocale(tag: string): DisplayLocale | undefined {
  let locale: Intl.Locale;
  try {
    locale = new Intl.Locale(tag);
  } catch (error) {
    if (error instanceof RangeError) return undefined;
    throw error;
  }

  if (locale.language === "zh") {
    // Chinese has distinct written forms. Match only Simplified Chinese.
    return locale.maximize().script === "Hans" ? "zh-CN" : undefined;
  }
  // Overleaf's `no` catalog uses Bokmål, reported as `nb` by some clients.
  if (locale.language === "nb") return "no";
  return localeByTag.get(locale.language);
}

export function resolveDisplayLocale(options: {
  selected?: string | undefined;
  saved?: string | undefined;
  preferred?: readonly string[];
}): DisplayLocale {
  const candidates = [
    options.selected,
    options.saved,
    ...(options.preferred ?? []),
  ];
  for (const candidate of candidates) {
    if (candidate === undefined) continue;
    const matched = matchDisplayLocale(candidate);
    if (matched !== undefined) return matched;
  }
  return "en";
}

/** Use the terminal's message locale, including the POSIX encoding suffix. */
export function terminalDisplayLocale(
  environment: Readonly<Record<string, string | undefined>>,
  osLocale: string = new Intl.DateTimeFormat().resolvedOptions().locale,
): DisplayLocale {
  const configured = environment.LC_ALL || environment.LC_MESSAGES || environment.LANG;
  if (configured && /^(?:C|POSIX)(?:[.@]|$)/i.test(configured)) return "en";
  const tags = [
    ...(environment.LANGUAGE?.split(":") ?? []),
    configured ?? osLocale,
  ].map((value) => value.split(/[.@]/, 1)[0]?.replaceAll("_", "-") ?? "");
  return resolveDisplayLocale({ preferred: tags });
}

/** Preserve header order for equally preferred locales. */
export function preferredDisplayLanguages(
  header: string | undefined,
): string[] {
  if (header === undefined) return [];
  return header
    .split(",")
    .flatMap((entry, index) => {
      const [language, quality, ...extra] = entry
        .split(";")
        .map((field) => field.trim());
      if (!language || language === "*" || extra.length > 0) return [];
      const match =
        quality === undefined
          ? undefined
          : /^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i.exec(quality);
      if (match === null) return [];
      const weight = match === undefined ? 1 : Number(match[1]);
      return weight === 0 ? [] : [{ language, weight, index }];
    })
    .sort((a, b) => b.weight - a.weight || a.index - b.index)
    .map(({ language }) => language);
}
