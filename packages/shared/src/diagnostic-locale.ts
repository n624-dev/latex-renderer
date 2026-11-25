import { readFileSync } from "node:fs";
import {
  preferredDisplayLanguages,
  resolveDisplayLocale,
  type DisplayLocale,
} from "./locale.js";

let cached:
  | { locale: DisplayLocale; messages: Readonly<Record<string, string>> }
  | undefined;

/** Translate recognized, user-visible diagnostics. Codes and arbitrary logs
 * are handled by their callers and are never used as translation templates. */
export function localizedDiagnostic(
  message: string,
  acceptLanguage?: string,
): string {
  const locale = resolveDisplayLocale({
    preferred: preferredDisplayLanguages(acceptLanguage),
  });
  if (locale === "en") return message;
  if (cached?.locale !== locale) {
    const file = new URL(
      `../locales/diagnostics/${locale}.json`,
      import.meta.url,
    );
    cached = {
      locale,
      messages: JSON.parse(readFileSync(file, "utf8")) as Record<
        string,
        string
      >,
    };
  }
  return Object.hasOwn(cached.messages, message)
    ? (cached.messages[message] ?? message)
    : message;
}
