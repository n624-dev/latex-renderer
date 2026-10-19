import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import matter from "gray-matter";
import { Marked, Renderer, type Tokens } from "marked";
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
}

export interface PublicDocHeading {
  depth: number;
  id: string;
  text: string;
}

const contentDirectory = fileURLToPath(
  new URL("../../../docs/public/", import.meta.url),
);
const sourceFiles = [
  "index.md",
  "client.md",
  "self-hosting.md",
  "web.md",
  "windows.md",
  "cli.md",
  "integrations.md",
  "mcp.md",
  "projects.md",
  "troubleshooting.md",
  "security.md",
  "api.md",
  "contributing.md",
  "reference.md",
] as const;

// Keep all existing URLs, ordering metadata and search categories intact.
// Navigation groups are presentation only, not document identity.
const navigationGroups = [
  {
    title: "利用する",
    slugs: [
      "index",
      "web",
      "client",
      "windows",
      "cli",
      "integrations",
      "mcp",
      "projects",
    ],
  },
  {
    title: "運用・開発",
    slugs: [
      "self-hosting",
      "troubleshooting",
      "security",
      "api",
      "contributing",
      "reference",
    ],
  },
];

export function renderPublicDoc(slug: string): string {
  const document = docsBySlug.get(slug);
  if (document === undefined)
    throw new Error(`Unknown public document: ${slug}`);
  const navigation = navigationGroups
    .map(
      ({ title, slugs }) =>
        `<section class="docs-nav-group"><h2>${escapeHtml(title)}</h2>${slugs
          .map((itemSlug) => docsBySlug.get(itemSlug))
          .filter((item): item is PublicDoc => item !== undefined)
          .map(
            (item) =>
              `<a href="${docUrl(item.slug)}"${item.slug === slug ? ' aria-current="page"' : ""}>${escapeHtml(item.title)}</a>`,
          )
          .join("")}</section>`,
    )
    .join("");
  const toc =
    document.headings.length < 5
      ? ""
      : `<nav class="docs-toc" aria-label="ページ内目次"><strong>このページ</strong>${document.headings.map((heading) => `<a class="toc-depth-${heading.depth}" href="#${escapeHtml(heading.id)}">${escapeHtml(heading.text)}</a>`).join("")}</nav>`;
  const index = publicDocs.indexOf(document);
  const previous = publicDocs[index - 1];
  const next = publicDocs[index + 1];
  const pager = `<nav class="docs-pager" aria-label="前後のページ">${previous === undefined ? "<span></span>" : `<a rel="prev" href="${docUrl(previous.slug)}">← ${escapeHtml(previous.title)}</a>`}${next === undefined ? "<span></span>" : `<a rel="next" href="${docUrl(next.slug)}">${escapeHtml(next.title)} →</a>`}</nav>`;
  return shell(
    document.title,
    `<div class="docs-layout"><aside class="docs-sidebar"><label for="docs-search">ドキュメント検索</label><input id="docs-search" type="search" autocomplete="off" placeholder="本文と見出しを検索" aria-controls="docs-search-results"><div id="docs-search-results" class="docs-search-results" role="status" aria-live="polite"></div><details class="docs-menu"><summary>使い方の一覧</summary><nav class="docs-nav" aria-label="ドキュメント内ナビゲーション">${navigation}</nav></details></aside><div class="docs-main"><div class="hero docs-hero"><h1>${escapeHtml(document.title)}</h1><p>${escapeHtml(document.description)}</p></div>${toc}<article class="docs-content">${document.html}</article><footer class="docs-meta"><p>更新: <time datetime="${escapeHtml(document.updated)}">${escapeHtml(document.updated)}</time> / 対象: ${escapeHtml(document.since)}以降</p><p><a class="docs-edit-link" href="https://github.com/n624-dev/latex-renderer/edit/main/${encodeURI(document.sourcePath)}">GitHubで編集</a></p></footer>${pager}</div></div>`,
  );
}

export function publicDocsSearchJson(): string {
  return `${JSON.stringify(
    publicDocs.map((document) => ({
      title: document.title,
      description: document.description,
      category: document.category,
      url: docUrl(document.slug),
      headings: document.headings,
      text: document.markdown
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

function loadPublicDoc(filename: string): PublicDoc {
  const sourcePath = `docs/public/${filename}`;
  const parsed = matter(readFileSync(join(contentDirectory, filename), "utf8"));
  const metadata = validateMetadata(parsed.data, sourcePath);
  if (filename !== `${metadata.slug}.md`) {
    throw new Error(`${sourcePath}: frontmatter slug must match its filename`);
  }
  return {
    ...metadata,
    sourcePath,
    markdown: parsed.content,
    ...renderMarkdownDocument(parsed.content),
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
): Pick<PublicDoc, "html" | "headings"> {
  const headings: PublicDocHeading[] = [];
  const renderer = new DocsRenderer(headings);
  const marked = new Marked();
  const rendered = marked.parse(markdown, { gfm: true, renderer });
  if (typeof rendered !== "string") {
    throw new Error("Asynchronous Markdown rendering is not supported");
  }
  return {
    html: rendered
      .replaceAll("<table>", '<div class="table-wrap"><table>')
      .replaceAll("</table>", "</table></div>"),
    headings,
  };
}

class DocsRenderer extends Renderer {
  readonly #headingCounts = new Map<string, number>();
  readonly #headings: PublicDocHeading[];

  constructor(headings: PublicDocHeading[]) {
    super();
    this.#headings = headings;
  }

  override heading({ tokens, depth, text }: Tokens.Heading): string {
    const base = headingSlug(text);
    const count = (this.#headingCounts.get(base) ?? 0) + 1;
    this.#headingCounts.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    if (depth === 2 || depth === 3) this.#headings.push({ depth, id, text });
    return `<h${depth} id="${escapeHtml(id)}">${this.parser.parseInline(tokens)}<a class="heading-permalink" href="#${escapeHtml(id)}" aria-label="この見出しへのリンク">#</a></h${depth}>\n`;
  }

  override blockquote({ tokens }: Tokens.Blockquote): string {
    // A deliberately small Markdown-only disclosure syntax. Raw HTML remains
    // escaped; titles and nested content use the existing safe renderers.
    const first = tokens[0];
    const firstText: unknown =
      first?.type === "paragraph" ? first.text : undefined;
    if (
      typeof firstText === "string" &&
      /^\[!DETAILS\] [^\n]+$/.test(firstText)
    ) {
      return `<details class="docs-details"><summary>${escapeHtml(firstText.slice(11))}</summary>${this.parser.parse(tokens.slice(1))}</details>\n`;
    }
    const rendered = this.parser.parse(tokens);
    const match = rendered.match(/^<p>\[!(NOTE|WARNING)\]\s*/);
    if (match === null) return `<blockquote>\n${rendered}</blockquote>\n`;
    const kind = match[1]?.toLowerCase() ?? "note";
    return `<div class="notice ${kind}">${rendered.replace(match[0], "<p>")}</div>\n`;
  }

  override html({ text }: Tokens.HTML | Tokens.Tag): string {
    return escapeHtml(text);
  }
}

function headingSlug(value: string): string {
  const slug = value
    .normalize("NFKC")
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replaceAll(/^-|-$/g, "");
  return slug || "section";
}

function docUrl(slug: string): string {
  return slug === "index" ? "/docs/" : `/docs/${slug}/`;
}

export const publicDocs: readonly PublicDoc[] = sourceFiles
  .map(loadPublicDoc)
  .sort((left, right) => left.navOrder - right.navOrder);

const docsBySlug = new Map(
  publicDocs.map((document) => [document.slug, document]),
);
