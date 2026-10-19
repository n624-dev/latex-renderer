import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { part6 } from "../apps/admin-web/src/assets/admin-script-parts/part-6.js";
import { part5 } from "../apps/admin-web/src/assets/admin-script-parts/part-5.js";
import { escapeHtml } from "../apps/admin-web/src/templates-shared.js";
import {
  homePage,
  downloadsPage,
  statusPage,
} from "../apps/admin-web/src/templates-pages.js";
import { setupStyle } from "../deploy/scripts/server-setup-assets.mjs";

describe("concise public UI", () => {
  it("keeps TeX controls and one construction warning while folding maintenance details", async () => {
    const out = { innerHTML: "" };
    await new Promise<void>((resolve, reject) => {
      runInNewContext(`${part6}\ntexEnvironment().then(done, fail)`, {
        request: (path: string) =>
          Promise.resolve(
            path.endsWith("/state")
              ? { desired: {}, current: null, previous: null }
              : path.endsWith("/images")
                ? {
                    repository: "registry.example/texlive",
                    daily: ["2026-10-17"],
                    weekly: [],
                  }
                : {
                    items: [
                      {
                        id: "collection-langjapanese",
                        description: "日本語",
                        recommended: true,
                      },
                    ],
                    effectiveCountry: "JP",
                  },
          ),
        out,
        esc: escapeHtml,
        section: (title: string, body: string) =>
          `<section><h2>${title}</h2>${body}</section>`,
        document: {
          querySelector: () => ({
            value: "latest",
            disabled: false,
            checked: false,
          }),
        },
        done: resolve,
        fail: reject,
      });
    });
    expect(out.innerHTML).not.toContain('class="eyebrow"');
    expect(out.innerHTML).not.toContain("Image Manager");
    expect(out.innerHTML).toContain('<option value="weekly">週次版</option>');
    expect(out.innerHTML).toContain("<details><summary>保守操作</summary>");
    expect(out.innerHTML).toContain(
      "<details><summary>言語の表示設定</summary>",
    );
    expect(out.innerHTML).toContain("<summary>言語の識別子</summary>");
    expect(out.innerHTML).toContain(
      'name="tex-language" value="collection-langjapanese"',
    );
    expect(out.innerHTML).toContain(
      'id="tex-rebuild-missing" type="checkbox" checked',
    );
    expect(out.innerHTML.match(/CPU・ディスク容量/g)).toHaveLength(1);
  });

  it("does not enable non-functional selection controls in the current job list", async () => {
    const selectionFlags: boolean[] = [];
    await new Promise<void>((resolve, reject) => {
      runInNewContext(`${part5}\njobs().then(done, fail)`, {
        location: { search: "" },
        URLSearchParams,
        request: () => Promise.resolve({ items: [] }),
        out: { innerHTML: "" },
        section: (_title: string, body: string) => body,
        table: (
          _items: unknown,
          _columns: unknown,
          _actions: unknown,
          select = false,
        ) => {
          selectionFlags.push(select);
          return "";
        },
        nextPage: () => "",
        esc: escapeHtml,
        document: { querySelector: () => ({ onsubmit: null }) },
        bindAction: () => {},
        done: resolve,
        fail: reject,
      });
    });
    expect(selectionFlags).toEqual([false]);
  });

  it("retains Runtime fingerprints and dependent languages inside optional details", () => {
    const html: unknown = runInNewContext(
      `${part6}\ntexRuntimeCard(runtime, '現在の環境')`,
      {
        runtime: {
          languages: ["collection-langjapanese"],
          effectiveLanguageCollections: [
            "collection-langjapanese",
            "collection-langcjk",
          ],
          snapshotDate: "2026-10-17",
          baseDigest: "sha256:example",
        },
        esc: escapeHtml,
      },
    );
    expect(typeof html).toBe("string");
    if (typeof html !== "string") throw new Error("Expected Runtime card");
    expect(html).toContain("2026-10-17");
    expect(html).toContain("collection-langjapanese");
    expect(html.indexOf("sha256:example")).toBeGreaterThan(
      html.indexOf("<details>"),
    );
    expect(html.indexOf("collection-langcjk")).toBeGreaterThan(
      html.indexOf("<details>"),
    );
  });

  it("keeps the account requirement and entry points without decorative headings", () => {
    const html = homePage();
    expect(html).not.toContain('class="eyebrow"');
    expect(html).toContain("管理者が用意したアカウント");
    for (const path of [
      "/app/",
      "/downloads/",
      "/docs/",
      "/docs/web/",
      "/docs/integrations/",
      "/docs/api/",
    ]) {
      expect(html).toContain(`href="${path}"`);
    }
    expect(html.match(/href="\/"/g)).toHaveLength(1);
  });

  it("retains latest and exact-version downloads while moving detailed instructions to docs", () => {
    const html = downloadsPage(
      "1.2.3",
      "client-1.2.3.zip",
      "extension-1.2.3.mcpb",
    );
    for (const path of [
      "client/install.mjs",
      "client/latest.zip",
      "client/client-1.2.3.zip",
      "mcpb/latest.mcpb",
      "mcpb/extension-1.2.3.mcpb",
    ]) {
      expect(html).toContain(`href="/downloads/${path}"`);
    }
    expect(html).toContain("クライアント 1.2.3");
    expect(html).toContain('href="/docs/client/"');
    expect(html).toContain('href="/docs/security/"');
    expect(html).not.toContain('class="eyebrow"');
    expect(html).not.toContain("DPAPI");
    expect(downloadsPage("1.2.3", "client.zip")).not.toContain(
      "/downloads/mcpb/",
    );
  });

  it("keeps availability and check time without prescribing API keys to Web users", () => {
    const html = statusPage({
      api: true,
      rendering: false,
      downloads: true,
      checkedAt: "2026-10-19T00:00:00.000Z",
    });
    expect(html).toContain("レンダリング処理：停止または確認不可");
    expect(html).toContain('datetime="2026-10-19T00:00:00.000Z"');
    expect(html).toContain('href="/docs/troubleshooting/"');
    expect(html).not.toContain("APIキーを確認");
    expect(html).not.toContain('class="eyebrow"');
  });

  it("gives hidden setup controls precedence over grid and checkbox label layouts", () => {
    expect(setupStyle).toContain("[hidden] { display:none !important; }");
    expect(setupStyle).toContain("label { display:grid;");
  });
});
