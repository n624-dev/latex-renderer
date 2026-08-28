import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { docsPage as selectedDocsPage } from "../apps/admin-web/src/docs-pages.js";
import {
  docsPage,
  integrationsDocsPage,
  publicDocs,
  renderMarkdown,
} from "../apps/admin-web/src/markdown-docs.js";
import {
  legacyApiDocsPage,
  legacyDocsPage,
} from "../apps/admin-web/src/templates-docs.js";

describe("Markdown public documentation", () => {
  afterEach(() => vi.unstubAllEnvs());
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
    ]);
    expect(new Set(publicDocs.map(({ navOrder }) => navOrder)).size).toBe(13);
    for (const document of publicDocs) {
      expect(document.sourcePath).toBe(`docs/public/${document.slug}.md`);
      expect(document.title).not.toBe("");
      expect(document.category).not.toBe("");
      expect(document.description).not.toBe("");
      expect(document.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(document.since).toBe(
        document.slug === "self-hosting" ? "v1.1.0" : "v1.0.0",
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
    expect(selfHosting).toBeDefined();
    expect(selfHosting?.html).toContain("latex-renderer-server-1.1.4.tar.gz");
    expect(selfHosting?.html).toContain(
      "/opt/latex-renderer/update-staging",
    );
    expect(selfHosting?.html).toContain(
      "chmod 2770 /var/lib/latex-renderer",
    );
    expect(selfHosting?.html).toContain("現在の提供状況");
    expect(selfHosting?.html).toContain(
      "公開後にタグや配布ファイルを差し替えできない",
    );
    expect(selfHosting?.html).toContain("sha256sum --check");
    expect(selfHosting?.html).toContain(
      "corepack install --global pnpm@11.24.0",
    );
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
    expect(page).toContain('<time datetime="2026-08-28">');
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
