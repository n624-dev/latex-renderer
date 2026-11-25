import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import type { DisplayLocale } from "@latex-renderer/shared/locale";
import matter from "gray-matter";
import { Marked, Renderer, type Token, type Tokens } from "marked";
import { siteText } from "./site-messages.js";
import { escapeHtml, shell } from "./templates-shared.js";

export interface PublicDocMetadata {
  slug: string;
  category: string;
  title: string;
  description: string;
  navOrder: number;
  updated: string;
  since: string;
  sourcePath: string;
}

export interface PublicDoc extends PublicDocMetadata {
  markdown: string;
  html: string;
  headings: readonly PublicDocHeading[];
  searchableMarkdown: string;
  anchorAliases?: Readonly<Record<string, string>>;
}

export interface PublicDocHeading {
  depth: number;
  id: string;
  text: string;
  historical?: true;
}

const contentDirectory = fileURLToPath(
  new URL("../../../docs/public/", import.meta.url),
);
const sourceFiles = [
  "index.md",
  "client.md",
  "self-hosting.md",
  "server-setup.md",
  "lan-https.md",
  "lan-https-authority.md",
  "updates.md",
  "backups.md",
  "web.md",
  "windows.md",
  "cli.md",
  "integrations.md",
  "mcp.md",
  "projects.md",
  "outputs.md",
  "troubleshooting.md",
  "security.md",
  "api.md",
  "contributing.md",
  "reference.md",
] as const;

const navigationGroups = [
  {

    slugs: [
      "index",
      "web",
      "client",
      "windows",
      "cli",
      "integrations",
      "mcp",
      "projects",
      "outputs",
      "troubleshooting",
    ],
  },
  {

    slugs: [
      "self-hosting",
      "server-setup",
      "lan-https",
      "lan-https-authority",
      "updates",
      "backups",
    ],
  },
  {

    slugs: ["api", "security", "contributing", "reference"],
  },
];

const englishAliases: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  index: { "make-your-first-pdf": "最短でpdfを作る" },
  web: {
    "convert-files-to-a-pdf": "ブラウザでpdfへ変換",
    "edit-a-project": "ブラウザーで文書を編集する",
  },
};

export function renderPublicDoc(
  slug: string,
  language?: DisplayLocale,
): string {
  const locale = language ?? "ja";
  const t = siteText(locale);
  const documents = getPublicDocs(locale);
  const bySlug = new Map(documents.map((doc) => [doc.slug, doc]));
  const url = (item: string) => docUrl(item, language);
  const document = bySlug.get(slug);
  if (document === undefined)
    throw new Error(`Unknown public document: ${slug}`);
  const titles = [t("docsUsing"), t("docsRunning"), t("docsIntegration")];
  const navigation = navigationGroups
    .map(({ slugs }, index) => {
      const links = slugs
        .map((itemSlug) => bySlug.get(itemSlug))
        .filter((item): item is PublicDoc => item !== undefined)
        .map(
          (item) =>
            `<a href="${url(item.slug)}"${item.slug === slug ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a>`,
        )
        .join("");
      return links
        ? `<section class="docs-nav-group"><h2>${escapeHtml(titles[index] ?? "")}</h2>${links}</section>`
        : "";
    })
    .join("");
  const contents = escapeHtml(t("docsContents"));
  const toc =
    document.headings.length < 5
      ? ""
      : `<details class="docs-toc"><summary>${contents}</summary><nav aria-label="${contents}">${document.headings.map((heading) => `<a class="toc-depth-${heading.depth}" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`).join("")}</nav></details>`;
  const index = documents.indexOf(document);
  const previous = documents[index - 1];
  const next = documents[index + 1];
  const pager = `<nav class="docs-pager" aria-label="${escapeHtml(t("docsRelated"))}">${previous === undefined ? "<span></span>" : `<a rel="prev" href="${url(previous.slug)}"><small>${escapeHtml(t("docsPrevious"))}</small>${escapeHtml(previous.title)}</a>`}${next === undefined ? "" : `<a rel="next" href="${url(next.slug)}"><small>${escapeHtml(t("docsNext"))}</small>${escapeHtml(next.title)}</a>`}</nav>`;
  const footer =
    document.slug === "contributing"
      ? ""
      : `<p><a href="${url("contributing")}">${escapeHtml(t("docsFeedback"))}</a></p>`;
  const indexUrl = language === undefined
    ? "/assets/docs-search.json"
    : `/${language}/assets/docs-search.json`;
  const html = language === "ja"
    ? document.html.replaceAll('href="/docs/', 'href="/ja/docs/')
    : document.html;
  return shell(
    document.title,
    `<div class="docs-layout">
      <aside class="docs-sidebar">
        <div class="docs-search">
          <label for="docs-search">${escapeHtml(t("docsSearch"))}</label>
          <input id="docs-search" type="search" autocomplete="off" placeholder="${escapeHtml(t("docsExample"))}" aria-controls="docs-search-results" data-index-url="${indexUrl}">
          <div id="docs-search-results" class="docs-search-results" role="status" aria-live="polite"></div>
        </div>
        <details class="docs-menu"><summary>${escapeHtml(t("docsAll"))}</summary><nav class="docs-nav" aria-label="${escapeHtml(t("docsNavigation"))}">${navigation}</nav></details>
      </aside>
      <div class="docs-main">
        <div class="docs-hero"><h1>${escapeHtml(document.title)}</h1><p>${escapeHtml(document.description)}</p></div>
        ${toc}
        <article class="docs-content">${html}</article>
        ${pager}
        <footer class="docs-meta"><p>${escapeHtml(t("docsUpdated"))} <time datetime="${escapeHtml(document.updated)}">${escapeHtml(document.updated)}</time></p><p><a href="https://github.com/n624-dev/latex-renderer/blob/main/${document.sourcePath}">${escapeHtml(t("docsSource"))}</a></p>${footer}</footer>
      </div>
    </div>`,
    locale,
    { docsRoot: url("index"), languageUrl: (choice) => docUrl(slug, choice) },
  );
}

export function publicDocsSearchJson(language?: DisplayLocale): string {
  const documents = getPublicDocs(language ?? "ja");
  return `${JSON.stringify(
    documents.map((document) => ({
      title: document.title,
      description: document.description,
      category: document.category,
      url: docUrl(document.slug, language),
      headings: document.headings.filter(({ historical }) => !historical),
      text: document.searchableMarkdown
        .replaceAll(/[`*_>#|(){}~-]/g, " ")
        .replaceAll("[", " ")
        .replaceAll("]", " ")
        .replaceAll(/\s+/g, " ")
        .trim(),
    })),
  )}\n`;
}

export const docsPage = () => renderPublicDoc("index");
export const windowsDocsPage = () => renderPublicDoc("windows");
export const cliDocsPage = () => renderPublicDoc("cli");
export const integrationsDocsPage = () => renderPublicDoc("integrations");
export const projectsDocsPage = () => renderPublicDoc("projects");
export const troubleshootingDocsPage = () => renderPublicDoc("troubleshooting");
export const apiDocsPage = () => renderPublicDoc("api");

function loadPublicDoc(
  filename: string,
  language: DisplayLocale = "ja",
): PublicDoc {
  const path = language === "ja" ? filename : `${language}/${filename}`;
  const sourcePath = `docs/public/${path}`;
  const parsed = matter(readFileSync(join(contentDirectory, path), "utf8"));
  const metadata = validateMetadata(parsed.data, sourcePath);
  if (filename !== `${metadata.slug}.md`) {
    throw new Error(`${sourcePath}: frontmatter slug must match its filename`);
  }
  const aliases = language === "en" ? englishAliases[metadata.slug] : undefined;
  return {
    ...metadata,
    sourcePath,
    markdown: parsed.content,
    ...renderMarkdownDocument(parsed.content, language, aliases),
    ...(aliases === undefined ? {} : { anchorAliases: aliases }),
  };
}

function validateMetadata(
  value: Record<string, unknown>,
  sourcePath: string,
): Omit<PublicDocMetadata, "sourcePath"> {
  const stringField = (name: string): string => {
    const field = value[name];
    if (typeof field !== "string" || field.trim().length === 0) {
      throw new Error(
        `${sourcePath}: frontmatter ${name} must be a non-empty string`,
      );
    }
    return field;
  };
  if (!Number.isInteger(value.navOrder) || Number(value.navOrder) < 0) {
    throw new Error(
      `${sourcePath}: frontmatter navOrder must be a non-negative integer`,
    );
  }
  const slug = stringField("slug");
  if (!/^(?:index|[a-z][a-z0-9-]*)$/.test(slug)) {
    throw new Error(`${sourcePath}: frontmatter slug is invalid`);
  }
  const updated = stringField("updated");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    throw new Error(`${sourcePath}: frontmatter updated must use YYYY-MM-DD`);
  }
  return {
    slug,
    title: stringField("title"),
    category: stringField("category"),
    description: stringField("description"),
    navOrder: Number(value.navOrder),
    updated,
    since: stringField("since"),
  };
}

export function renderMarkdown(markdown: string): string {
  return renderMarkdownDocument(markdown).html;
}

function renderMarkdownDocument(
  markdown: string,
  locale: DisplayLocale = "ja",
  aliases?: Readonly<Record<string, string>>,
): Pick<PublicDoc, "html" | "headings" | "searchableMarkdown"> {
  const headings: PublicDocHeading[] = [];
  const renderer = new DocsRenderer(headings, locale, aliases);
  const marked = new Marked();
  const tokens = marked.lexer(markdown, { gfm: true });
  const rendered = marked.parser(tokens, { gfm: true, renderer });
  return {
    html: rendered
      .replaceAll("<table>", '<div class="table-wrap"><table>')
      .replaceAll("</table>", "</table></div>"),
    headings,
    searchableMarkdown: tokens
      .filter((token) => !historicalDetails(token))
      .map((token) => token.raw)
      .join(""),
  };
}

class DocsRenderer extends Renderer {
  readonly #headingCounts = new Map<string, number>();
  readonly #headings: PublicDocHeading[];
  #historical = false;

  constructor(
    headings: PublicDocHeading[],
    private readonly locale: DisplayLocale,
    private readonly aliases?: Readonly<Record<string, string>>,
  ) {
    super();
    this.#headings = headings;
  }

  override heading({ tokens, depth, text }: Tokens.Heading): string {
    const explicitId = text.match(
      / \{#([\p{Letter}\p{Number}][\p{Letter}\p{Number}-]*)\}$/u,
    );
    const label = explicitId ? text.slice(0, -explicitId[0].length) : text;
    const base = explicitId?.[1] ?? headingSlug(label);
    const count = (this.#headingCounts.get(base) ?? 0) + 1;
    this.#headingCounts.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    if (depth === 2 || depth === 3)
      this.#headings.push({
        depth,
        id,
        text: label,
        ...(this.#historical ? { historical: true } : {}),
      });
    const rendered = this.parser.parseInline(tokens);
    const body = explicitId
      ? rendered.slice(0, -explicitId[0].length)
      : rendered;
    const alternateAnchors = Object.entries(this.aliases ?? {})
      .filter(([, target]) => target === id)
      .map(([alias]) => `<span id="${escapeHtml(alias)}" aria-hidden="true"></span>`)
      .join("");
    const labelLink = escapeHtml(siteText(this.locale)("headingLink"));
    return `<h${depth} id="${escapeHtml(id)}">${alternateAnchors}${body}<a class="heading-permalink" href="#${escapeHtml(id)}" aria-label="${labelLink}">#</a></h${depth}>\n`;
  }

  override blockquote(quote: Tokens.Blockquote): string {
    // A deliberately small Markdown-only disclosure syntax. Raw HTML remains
    // escaped; titles and nested content use the existing safe renderers.
    const title = detailsTitle(quote);
    if (title !== undefined) {
      const wasHistorical = this.#historical;
      this.#historical = wasHistorical || historicalDetails(quote);
      const body = this.parser.parse(quote.tokens.slice(1));
      this.#historical = wasHistorical;
      const label = historicalDetails(quote)
        ? title.replace(/^履歴資料/u, siteText(this.locale)("historical"))
        : title;
      return `<details class="docs-details"><summary>${escapeHtml(label)}</summary>${body}</details>\n`;
    }
    const rendered = this.parser.parse(quote.tokens);
    const match = rendered.match(/^<p>\[!(NOTE|WARNING)\]\s*/);
    if (match === null) return `<blockquote>\n${rendered}</blockquote>\n`;
    const kind = match[1]?.toLowerCase() ?? "note";
    return `<div class="notice ${kind}">${rendered.replace(match[0], "<p>")}</div>\n`;
  }

  override html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  }
}

function detailsTitle(quote: Tokens.Blockquote): string | undefined {
  const first = quote.tokens[0];
  const text: unknown = first?.type === "paragraph" ? first.text : undefined;
  return typeof text === "string"
    ? /^\[!DETAILS\] ([^\n]+)$/.exec(text)?.[1]
    : undefined;
}

function historicalDetails(token: Token): boolean {
  return (
    token.type === "blockquote" &&
    (detailsTitle(token as Tokens.Blockquote)?.startsWith("履歴資料") ?? false)
  );
}

function headingSlug(value: string): string {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-|-$/g, "");
  return slug || "section";
}

export function docUrl(slug: string, language?: DisplayLocale): string {
  const root = language === undefined ? "/docs/" : `/${language}/docs/`;
  return slug === "index" ? root : `${root}${slug}/`;
}

function loadDocs(locale: DisplayLocale): readonly PublicDoc[] {
  return sourceFiles
    .map((filename) => loadPublicDoc(filename, locale))
    .sort((left, right) => left.navOrder - right.navOrder);
}

export const publicDocs = loadDocs("ja");

// The process keeps the legacy Japanese set and the most recently used
// localized set. Generating the static site also reads one language at a time.
let localized: { locale: DisplayLocale; documents: readonly PublicDoc[] } | undefined;

export function getPublicDocs(locale: DisplayLocale): readonly PublicDoc[] {
  if (locale === "ja") return publicDocs;
  if (localized?.locale !== locale)
    localized = { locale, documents: loadDocs(locale) };
  return localized.documents;
}

export const publicDocSlugs = sourceFiles.map((filename) => filename.slice(0, -3));
