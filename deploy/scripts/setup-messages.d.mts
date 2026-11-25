import type { DisplayLocale } from "../../packages/shared/src/locale.js";

export function setupTexts(
  locale: DisplayLocale,
): Readonly<Record<string, string>>;
export function browserSetupLocale(header?: string): DisplayLocale;
export function terminalSetupText(
  key: string,
  values?: Readonly<Record<string, string | number>>,
): string;
