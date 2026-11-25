import type { DisplayLocale } from "@latex-renderer/shared/locale";
import { docUrl } from "./markdown-docs.js";
import { siteText } from "./site-messages.js";
import { escapeHtml, shell } from "./templates-shared.js";
import type { StatusSnapshot } from "./status-probe.js";

export function homePage(locale: DisplayLocale = "ja"): string {
  const t = siteText(locale);
  const doc = (slug: string) => docUrl(slug, locale);
  const methods = siteText(locale, escapeHtml)("homeMethods", {
    web: link(doc("web"), t("webApp")),
    cli: link(doc("cli"), "CLI"),
    ai: link(doc("mcp"), t("aiIntegrations")),
    api: link(doc("api"), "API"),
  });
  return shell(
    t("home"),
    `<div class="hero" data-public-page="home"><h1>${escapeHtml(t("convert"))}</h1><p>${escapeHtml(t("homeDescription"))}</p><div class="actions"><a class="button" href="/app/">${escapeHtml(t("convertInBrowser"))}</a><a class="button secondary" href="/${locale}/downloads/">${escapeHtml(t("downloadClient"))}</a><a class="button ghost" href="${doc("index")}">${escapeHtml(t("readGuides"))}</a></div></div><section><h2>${escapeHtml(t("getStarted"))}</h2><p>${escapeHtml(t("homeSignIn"))} ${methods}</p><p>${escapeHtml(t("homeFailure"))}</p></section>`,
    locale,
    { languageUrl: (choice) => `/${choice}/` },
  );
}

export function loginPage(
  locale: DisplayLocale = "ja",
  languageUrl?: (choice: DisplayLocale) => string,
): string {
  const t = siteText(locale);
  return shell(
    t("signIn"),
    `<section class="login-panel"><h1>${escapeHtml(t("signIn"))}</h1><p id="login-message" role="alert">${escapeHtml(t("checkingSignIn"))}</p><div id="login-methods" class="stack"></div><noscript>${escapeHtml(t("signInJavascript"))}</noscript></section><script data-cfasync="false" type="module" src="/assets/login.js"></script>`,
    locale,
    { languageUrl: languageUrl ?? ((choice) => `?locale=${choice}`) },
  );
}

export function downloadsPage(
  version: string,
  archiveName: string,
  mcpbName?: string,
  locale: DisplayLocale = "ja",
): string {
  const t = siteText(locale);
  const doc = (slug: string) => docUrl(slug, locale);
  const setupGuide = link(doc("mcp") + "#ローカルファイルを直接扱う", t("claudeSetupGuide"));
  const mcpbSection = mcpbName === undefined ? "" : `<section><h2>${escapeHtml(t("claudeExtension"))}</h2><p>${escapeHtml(t("claudeDescription"))} ${siteText(locale, escapeHtml)("claudeSetup", { setupGuide })}</p><a class="button secondary" href="/downloads/mcpb/latest.mcpb" download>${escapeHtml(t("claudeDownload"))}</a></section>`;
  return shell(
    t("downloads"),
    `<div class="page-heading"><div><h1>${escapeHtml(t("downloads"))}</h1><p>${escapeHtml(t("clientVersion", { version }))}</p></div></div>
    <section><h2>${escapeHtml(t("installCli"))}</h2><p>${escapeHtml(t("chooseOs"))}</p>
    <ul><li>${link(doc("client") + "#debian-ubuntu-の-apt-パッケージ", t("installApt"))} ${escapeHtml(t("bundledNode"))}</li>
    <li>${link(doc("windows"), t("installWindows"))} ${escapeHtml(t("requiredNode"))}</li>
    <li>${link(doc("client") + "#homebrew-でインストール", t("installBrew"))}</li>
    <li>${link(doc("client") + "#linux-macos", t("installUnix"))} ${escapeHtml(t("requiredNode"))}</li></ul></section>
    ${mcpbSection}
    <details><summary>${escapeHtml(t("directDownloads"))}</summary><div class="actions"><a class="button secondary" href="/downloads/client/install.mjs" download>${escapeHtml(t("commonInstaller"))}</a><a class="button secondary" href="/downloads/client/latest.zip" download>${escapeHtml(t("latestZip"))}</a></div><p><a href="/downloads/client/${encodeURIComponent(archiveName)}" download>${escapeHtml(archiveName)}</a>${mcpbName === undefined ? "" : ` / <a href="/downloads/mcpb/${encodeURIComponent(mcpbName)}" download>${escapeHtml(mcpbName)}</a>`}</p></details>`,
    locale,
    { languageUrl: (choice) => `/${choice}/downloads/` },
  );
}

export function statusPage(status: StatusSnapshot, locale: DisplayLocale = "ja"): string {
  const t = siteText(locale);
  const item = (label: string, available: boolean, idle = false) =>
    `<p><span class="status ${available ? "active" : "failed"}">${escapeHtml(t("statusItem", { label, state: t(idle ? "statusIdle" : available ? "statusOnline" : "statusOffline") }))}</span></p>`;
  const troubleshooting = link(docUrl("troubleshooting", locale), t("statusGuide"));
  return shell(
    t("status"),
    `<div class="page-heading"><h1>${escapeHtml(t("status"))}</h1></div><section data-rendering-status="${status.rendering ? "online" : "offline"}">${item(t("website"), true)}${item("API", status.api, status.apiIdle)}${item(t("renderingService"), status.rendering)}${item(t("downloads"), status.downloads)}<p class="muted">${escapeHtml(t("statusUpdated"))}<time datetime="${escapeHtml(status.checkedAt)}">${escapeHtml(new Date(status.checkedAt).toLocaleString(locale, { timeZone: "Asia/Tokyo" }))}</time></p></section><p>${siteText(locale, escapeHtml)("statusTroubleshooting", { troubleshooting })}</p>`,
    locale,
    { languageUrl: (choice) => `?locale=${choice}` },
  );
}

export function publicPage404(locale: DisplayLocale = "ja"): string {
  const t = siteText(locale);
  return shell(
    t("notFound"),
    `<section><h1>${escapeHtml(t("notFound"))}</h1><p>${siteText(locale, escapeHtml)("notFoundInstruction", { homeLink: link(`/${locale}/`, t("returnHome")) })}</p></section>`,
    locale,
    { languageUrl: (choice) => `/${choice}/` },
  );
}

function link(href: string, label: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;
}
