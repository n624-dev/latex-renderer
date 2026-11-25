import {
  displayLocales,
  type DisplayLocale,
} from "@latex-renderer/shared/locale";
import { languageName, siteCatalog, siteText } from "./site-messages.js";
import { fontStylesheet, regionalFontStylesheets } from "./assets/font-assets.js";

const browserKeys = [
  "themeLight", "themeDark", "themeSystem", "themeLabel", "themeAria",
  "sessionError", "sessionReload", "signOutError", "table", "codeExample",
  "copy", "copied", "copyError", "noMatches", "searchError",
  "invalidResponse", "signInError", "cloudflareLogin", "loginName",
  "password", "signIn", "or", "providerLogin",
] as const;

export function siteLanguagePicker(
  locale: DisplayLocale,
  url: (locale: DisplayLocale) => string,
): string {
  const label = siteText(locale)("language");
  return `<details class="language-picker"><summary>${escapeHtml(label)}</summary><ul>${displayLocales.map((choice) =>
    `<li><a href="${escapeHtml(url(choice))}" lang="${choice}" hreflang="${choice}"${choice === locale ? ' aria-current="true"' : ""}>${escapeHtml(languageName(choice))}</a></li>`,
  ).join("")}</ul></details>`;
}

export function shell(
  title: string,
  body: string,
  language: DisplayLocale = "ja",
  options?: {
    docsRoot?: string;
    languageUrl?: (locale: DisplayLocale) => string;
  },
): string {
  const t = siteText(language);
  const root = options?.docsRoot ?? (language === "ja" ? "/docs/" : `/${language}/docs/`);
  const languagePicker = options?.languageUrl && siteLanguagePicker(language, options.languageUrl);
  const nav = `<nav aria-label="${escapeHtml(t("navigation"))}"><a href="${root}">${escapeHtml(t("guides"))}</a><a href="${root}api/">API</a><a href="/${language}/downloads/">${escapeHtml(t("downloads"))}</a><a href="/status/?locale=${language}">${escapeHtml(t("status"))}</a></nav>`;
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8">${siteMessageMetadata(language)}<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escapeHtml(title)} | LaTeX Renderer</title><link rel="stylesheet" href="/assets/styles.css"><script data-cfasync="false" src="/assets/site.js"></script></head><body><a class="skip-link" href="#main-content">${escapeHtml(t("skipContent"))}</a><header class="site-header"><strong><a href="/${language}/">LaTeX Renderer</a></strong>${nav}<div class="header-meta">${languagePicker ?? ""}<button type="button" class="secondary" data-theme-toggle>${escapeHtml(t("themeLabel", { theme: t("themeSystem") }))}</button></div></header><main id="main-content">${body}</main></body></html>`;
}

export function siteMessageMetadata(
  language: DisplayLocale,
  liveLocale = false,
): string {
  const catalog = siteCatalog(language);
  const messages = Object.fromEntries(browserKeys.map((key) => [key, catalog[key]]));
  const href =
    language === "ja" || language === "zh-CN" || language === "ko"
      ? regionalFontStylesheets[language]
      : undefined;
  const regional = href
    ? `<link id="regional-web-font" rel="stylesheet" href="${escapeHtml(href)}">`
    : "";
  const switcher = liveLocale
    ? `<meta name="regional-web-fonts" content="${escapeHtml(JSON.stringify(regionalFontStylesheets))}">`
    : "";
  return `<meta name="site-messages" content="${escapeHtml(JSON.stringify(messages))}"><link rel="stylesheet" href="${escapeHtml(fontStylesheet)}">${regional}${switcher}`;
}

export function endpoint(
  method: string,
  path: string,
  description: string,
  headers: string,
  request = "",
): string {
  return `<section class="endpoint"><h2><code>${method} ${path}</code></h2><p>${description}</p><pre><code>${headers}</code></pre>${request ? `<h3>リクエスト</h3><pre><code>${request}</code></pre>` : ""}</section>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
