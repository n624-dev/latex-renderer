import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docsPage as selectedDocsPage } from "../apps/admin-web/src/docs-pages.js";
import {
  docsPage,
  integrationsDocsPage,
  publicDocs,
  renderPublicDoc,
  renderMarkdown,
} from "../apps/admin-web/src/markdown-docs.js";
import {
  legacyApiDocsPage,
  legacyDocsPage,
} from "../apps/admin-web/src/templates-docs.js";

describe("Markdown public documentation", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("bounds empty YAML merge sources in the actual frontmatter dependency", () => {
    const require = createRequire(
      new URL("../apps/admin-web/package.json", import.meta.url),
    );
    const matter = require("gray-matter") as (source: string) => {
      data: Record<string, unknown>;
    };
    expect(matter("---\ntitle: Example\n---\nBody").data.title).toBe("Example");
    // Small fixture exceeding the default 10,000-source budget, not a CPU benchmark.
    const sources = Array.from({ length: 100 }, () => "{}").join(",");
    const targets = "  - <<: *arr\n".repeat(101);
    expect(() =>
      matter(`---\narr: &arr [${sources}]\ntargets:\n${targets}---\nBody`),
    ).toThrow(/maxTotalMergeKeys/);
  });

  it("loads ordered, complete frontmatter from repository Markdown files", () => {
    expect(publicDocs.map(({ slug }) => slug)).toEqual([
      "index",
      "client",
      "self-hosting",
      "windows",
      "web",
      "cli",
      "integrations",
      "mcp",
      "projects",
      "troubleshooting",
      "security",
      "api",
      "contributing",
      "reference",
    ]);
    expect(new Set(publicDocs.map(({ navOrder }) => navOrder)).size).toBe(14);
    for (const document of publicDocs) {
      expect(document.sourcePath).toBe(`docs/public/${document.slug}.md`);
      expect(document.title).not.toBe("");
      expect(document.category).not.toBe("");
      expect(document.description).not.toBe("");
      expect(document.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.since).toBe(
        document.slug === "self-hosting" ? "v1.2.0" : "v1.0.0",
      );
      expect(
        readFileSync(
          new URL(`../${document.sourcePath}`, import.meta.url),
          "utf8",
        ),
      ).toContain(`slug: ${document.slug}`);
    }
  });

  it("publishes the versioned general-user self-hosting guide", () => {
    const selfHosting = publicDocs.find(({ slug }) => slug === "self-hosting");
    const reference = publicDocs.find(({ slug }) => slug === "reference");
    expect(selfHosting).toBeDefined();
    expect(selfHosting?.html).toContain("latex-renderer-server-1.3.6.tar.gz");
    expect(selfHosting?.html).toContain("/opt/latex-renderer/update-staging");
    expect(selfHosting?.html).toContain("bootstrap-published-host.mjs");
    expect(selfHosting?.html).toContain("/opt/latex-renderer/updater");
    expect(reference?.html).toContain("bootstrap-update-manager-transition.sh");
    expect(reference?.html).toContain("bootstrap-build");
    expect(reference?.html).toContain("GitHub tokenを渡しません");
    expect(selfHosting?.html).toContain("--bundle");
    expect(selfHosting?.html).not.toContain(
      "chmod 2770 /var/lib/latex-renderer",
    );
    expect(selfHosting?.html).toContain("現在の提供状況");
    expect(selfHosting?.html).toContain(
      "公開後にタグや配布ファイルを差し替えできない",
    );
    expect(selfHosting?.html).toContain("sha256sum --check");
    expect(selfHosting?.html).toContain("install-host.sh");
    expect(selfHosting?.html).not.toContain("まだ正式提供前");
    expect(selfHosting?.html).toContain("main");
    expect(selfHosting?.html).toContain("TeX環境の初期設定");
    expect(selfHosting?.html).toContain("バックアップ");
  });

  it("renders Japanese, code, tables, admonitions, and stable heading anchors", () => {
    const page = docsPage();

    expect(page).toContain("最短でPDFを作る");
    expect(page).toContain('<code class="language-text">');
    expect(page).toContain('<div class="table-wrap"><table>');
    expect(page).toContain('<div class="notice warning">');
    expect(page).toContain('id="最短でpdfを作る"');
    expect(page).toContain('href="#最短でpdfを作る"');
    expect(page).toContain('aria-current="page"');
    expect(page).toContain('<time datetime="2026-10-19">');
  });

  it("deduplicates heading fragments and escapes raw HTML", () => {
    const html = renderMarkdown(
      "## 同じ見出し\n\n## 同じ見出し\n\n<script>alert(1)</script>",
    );

    expect(html).toContain('id="同じ見出し"');
    expect(html).toContain('id="同じ見出し-2"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("folds Markdown details without allowing raw HTML and retains nested anchors", () => {
    const html = renderMarkdown(
      '> [!DETAILS] <img src=x onerror=alert(1)>\n>\n> ### 詳細の見出し\n>\n> ```js\n> console.log("example");\n> ```\n>\n> <script>alert(1)</script>',
    );
    expect(html).toContain('<details class="docs-details">');
    expect(html).toContain("<summary>&lt;img");
    expect(html).toContain('id="詳細の見出し"');
    expect(html).toContain('class="language-js"');
    expect(html).not.toMatch(/<(?:script|img)\b/);
  });

  it("keeps relocated operating constraints and safe recovery procedures reachable", () => {
    const reference = renderPublicDoc("reference");
    for (const text of [
      "OUTPUT_BUSY",
      "X-Latex-Renderer-Client-IP",
      "remote_mcp.rpc_result",
      "bootstrap-update-manager-transition.sh",
      "ロックファイル自体を削除してはいけません",
      "Content",
      "1,000",
      "10,000",
    ]) {
      expect(reference).toContain(text);
    }
    expect(renderPublicDoc("api").match(/class="docs-details"/g)).toHaveLength(
      4,
    );
  });

  it("keeps every document reachable without decorative headings or repeated metadata", () => {
    for (const document of publicDocs) {
      const page = renderPublicDoc(document.slug);
      expect(page).not.toContain('class="eyebrow"');
      expect(page).toContain(
        '<details class="docs-menu"><summary>使い方の一覧</summary>',
      );
      expect(page.match(/class="docs-nav-group"/g)).toHaveLength(2);
      for (const entry of publicDocs) {
        expect(page).toContain(
          `href="${entry.slug === "index" ? "/docs/" : `/docs/${entry.slug}/`}"`,
        );
      }
      expect(page.indexOf('class="docs-meta"')).toBeGreaterThan(
        page.indexOf("</article>"),
      );
      expect(page).toContain(`/edit/main/${document.sourcePath}`);
      expect(page.includes('class="docs-toc"')).toBe(
        document.headings.length >= 5,
      );
    }
  });

  it.each([
    {
      label: "balanced parentheses",
      markdown: "[docs](/docs/(renderer))",
      href: "/docs/(renderer)",
    },
    {
      label: "unbalanced parentheses",
      markdown: "[docs](/docs/(renderer)",
      href: null,
    },
    {
      label: "Unicode whitespace after the destination",
      markdown: `[docs](/docs/${"\u2000".repeat(128)})`,
      href: "/docs/",
    },
  ])(
    "renders $label through the actual documentation renderer",
    ({ markdown, href }) => {
      const html = renderMarkdown(markdown);
      if (href === null) {
        expect(html).not.toContain("<a ");
        expect(html).toContain(markdown);
      } else {
        expect(html).toContain(`<a href="${href}">docs</a>`);
      }
    },
  );

  it("keeps detailed AI guidance outside the minimal Skill entry point", () => {
    const page = integrationsDocsPage();
    const skill = readFileSync(
      new URL("../integrations/latex-renderer/SKILL.md", import.meta.url),
      "utf8",
    );

    expect(page).toContain("references/");
    expect(skill).toContain("references/workflow.md");
    expect(skill).toContain("never render every `.tex` automatically");
    expect(skill.split("\n").length).toBeLessThan(30);
  });

  it("is deterministic and retains the legacy templates as a rollback path", () => {
    expect(docsPage()).toBe(docsPage());
    expect(legacyDocsPage()).toContain("最短でPDFを作る");
    expect(legacyApiDocsPage()).toContain("POST /api/v1/render-tickets");

    vi.stubEnv("PUBLIC_DOCS_SOURCE", "legacy");
    expect(selectedDocsPage()).toBe(legacyDocsPage());
  });
});
