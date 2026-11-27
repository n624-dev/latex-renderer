import { describe, expect, it } from "vitest";
import { readBrowserAsset } from "../apps/admin-web/src/browser-assets.js";
import { styles } from "../apps/admin-web/src/assets/styles.js";
import { createWebApp } from "../apps/admin-web/src/app.js";
import {
  docsPage,
  publicDocs,
  publicDocsSearchJson,
  renderPublicDoc,
} from "../apps/admin-web/src/markdown-docs.js";

const bytes = new TextEncoder().encode("test");
const distribution = {
  version: "0.2.0",
  archiveName: "latex-renderer-client-0.2.0.zip",
  manifest: bytes,
  installer: bytes,
  uninstaller: bytes,
  commonInstaller: bytes,
  commonUninstaller: bytes,
  archive: bytes,
  gatewayOpenApi: bytes,
  rendererOpenApi: bytes,
  adminOpenApi: bytes,
};

describe("documentation navigation", () => {
  it("provides grouped navigation, search, stable anchors, and paging", () => {
    const page = docsPage();

    expect(page).toContain('class="docs-layout"');
    expect(page).toContain('<label for="docs-search">');
    expect(page).toContain('aria-controls="docs-search-results"');
    expect(page).toContain('class="docs-nav-group"');
    expect(page).not.toContain('class="docs-toc"');
    expect(renderPublicDoc("api")).toContain('class="docs-toc"');
    expect(page).toContain('href="#最短でpdfを作る"');
    expect(page).toContain('rel="next"');
    expect(page).toContain('aria-current="page"');
  });

  it("indexes every Markdown page and heading without administrator content", () => {
    const index = JSON.parse(publicDocsSearchJson()) as Array<{
      title: string;
      text: string;
      headings: Array<{ text: string }>;
      url: string;
    }>;

    expect(index).toHaveLength(publicDocs.length);
    expect(index.map(({ url }) => url)).toContain("/docs/api/");
    expect(index.some(({ text }) => text.includes("日本語"))).toBe(true);
    expect(
      index
        .flatMap(({ headings }) => headings)
        .some(({ text }) => text === "共通エラー"),
    ).toBe(true);
    expect(JSON.stringify(index)).not.toContain("管理API資料");
  });

  it("serves the same search index from the VPS compatibility Web", async () => {
    const response = await createWebApp(distribution).request(
      "/assets/docs-search.json",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()) as unknown[]).toHaveLength(
      publicDocs.length,
    );
  });

  it("keeps historical migration links available without indexing their commands", () => {
    const heading = "v1.2.xのroot Updaterから権限分離Updaterへ移行する場合";
    expect(renderPublicDoc("reference")).toContain(heading);
    const index = publicDocsSearchJson();
    expect(index).not.toContain("bootstrap-update-manager-transition.sh");
    expect(index).not.toContain(heading);
    expect(index).toContain("サーバー設定ウィザード");
  });

  it("serves every public guide from the compatibility Web", async () => {
    const app = createWebApp(distribution);
    for (const { slug, title } of publicDocs) {
      const url = slug === "index" ? "/docs/" : `/docs/${slug}/`;
      const response = await app.request(url);
      expect(response.status, url).toBe(200);
      expect(await response.text(), url).toContain(`<h1>${title}</h1>`);
    }
  });

  it("supports keyboard-native search and code-copy controls on mobile", () => {
    expect(readBrowserAsset("site")).toContain("/assets/docs-search.json");
    expect(readBrowserAsset("site")).toContain("navigator.clipboard.writeText");
    expect(styles).toContain(
      ".docs-layout { grid-template-columns: minmax(0, 1fr); }",
    );
    expect(styles).toContain(".docs-sidebar { position: static;");
  });
});
