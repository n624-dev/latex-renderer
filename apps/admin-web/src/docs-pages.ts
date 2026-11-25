import process from "node:process";
import { displayLocales } from "@latex-renderer/shared/locale";
import {
  apiDocsPage as markdownApiDocsPage,
  cliDocsPage as markdownCliDocsPage,
  docsPage as markdownDocsPage,
  integrationsDocsPage as markdownIntegrationsDocsPage,
  projectsDocsPage as markdownProjectsDocsPage,
  troubleshootingDocsPage as markdownTroubleshootingDocsPage,
  windowsDocsPage as markdownWindowsDocsPage,
  docUrl,
  publicDocSlugs,
  renderPublicDoc,
} from "./markdown-docs.js";
import {
  legacyApiDocsPage,
  legacyCliDocsPage,
  legacyDocsPage,
  legacyIntegrationsDocsPage,
  legacyProjectsDocsPage,
  legacyTroubleshootingDocsPage,
  legacyWindowsDocsPage,
} from "./templates-docs.js";

const select = (markdown: () => string, legacy: () => string) => () =>
  process.env.PUBLIC_DOCS_SOURCE === "legacy" ? legacy() : markdown();

export const docsPage = select(markdownDocsPage, legacyDocsPage);
export const windowsDocsPage = select(
  markdownWindowsDocsPage,
  legacyWindowsDocsPage,
);
export const cliDocsPage = select(markdownCliDocsPage, legacyCliDocsPage);
export const integrationsDocsPage = select(
  markdownIntegrationsDocsPage,
  legacyIntegrationsDocsPage,
);
export const projectsDocsPage = select(
  markdownProjectsDocsPage,
  legacyProjectsDocsPage,
);
export const troubleshootingDocsPage = select(
  markdownTroubleshootingDocsPage,
  legacyTroubleshootingDocsPage,
);
export const apiDocsPage = select(markdownApiDocsPage, legacyApiDocsPage);

const legacyPages = new Map<string, () => string>([
  ["index", legacyDocsPage],
  ["windows", legacyWindowsDocsPage],
  ["cli", legacyCliDocsPage],
  ["integrations", legacyIntegrationsDocsPage],
  ["projects", legacyProjectsDocsPage],
  ["troubleshooting", legacyTroubleshootingDocsPage],
  ["api", legacyApiDocsPage],
]);

export function renderDocsPage(slug: string): string {
  const legacy = legacyPages.get(slug);
  if (process.env.PUBLIC_DOCS_SOURCE === "legacy" && legacy !== undefined)
    return legacy();
  return renderPublicDoc(slug);
}

export const publicDocumentationPages = publicDocSlugs.map((slug) => ({
  slug,
  url: docUrl(slug),
  render: () => renderDocsPage(slug),
}));

export const localizedDocumentation = displayLocales.map((locale) => ({
  locale,
  pages: publicDocSlugs.map((slug) => ({
    slug,
    url: docUrl(slug, locale),
    render: () => renderPublicDoc(slug, locale),
  })),
}));
