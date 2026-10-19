import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";
import { siteScript } from "../../apps/admin-web/src/assets/site-script.js";

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser?.close();
});

// Actual shipped CSS/site script in an isolated page. This does not claim
// full-service acceptance or physical-device/pinch-zoom verification.
describe.each(["light", "dark"] as const)("control layout: %s", (theme) => {
  it.each([390, 768, 1200])(
    "keeps controls separated and accessible at %ipx",
    async (width) => {
      if (!browser) throw new Error("Browser not started");
      const page = await newTestPage(browser, {
        viewport: { width, height: 900 },
      });
      try {
        await page.emulateMedia({ colorScheme: theme });
        await page.route("https://renderer.invalid/", (route) =>
          route.fulfill({
            contentType: "text/html",
            body: `<!doctype html><html lang="ja"><head><style>${styles}</style><script>${siteScript}</script></head><body>
        <header class="site-header"><strong>Renderer</strong><nav><a href="#main">変換</a><a href="#main">プロジェクト</a></nav></header>
        <main id="main"><div class="page-heading"><h1>文書の変換</h1><form class="inline-form"><input aria-label="文書名" value="日本語の文書"><button>作成</button></form></div>
        <form class="filter-bar"><input aria-label="検索"><button>検索</button><button type="button">クリア</button><button type="button">新規作成</button></form>
        <div class="actions"><button id="pdf">PDF</button><button id="disabled" disabled>実行不可</button><details id="svg"><summary>SVG成果物</summary><div style="height:150px">SVG一覧</div></details></div>
        <div class="table-wrap"><table class="responsive-table"><thead><tr><th>名前</th><th>操作</th></tr></thead><tbody>
        <tr><td data-label="名前">文書1</td><td data-label="操作" class="actions-cell"><div class="actions-group"><button>詳細</button><button class="danger">削除</button></div></td></tr>
        <tr><td data-label="名前">文書2</td><td data-label="操作" class="actions-cell"><div class="actions-group"><button>詳細</button><button class="danger">削除</button></div></td></tr>
        </tbody></table></div>
        <article class="docs-content"><pre><code>${"long_code ".repeat(50)}</code></pre></article>
        <p id="app-error" aria-live="polite"></p>
        <details class="job-technical"><summary>技術情報</summary><code>Job ID: test\nERROR: example</code></details>
        <button id="open-dialog">設定を開く</button><dialog><div class="dialog-heading"><h2>設定</h2><button class="dialog-close" aria-label="閉じる">×</button></div><label hidden>非表示<input value="hidden"></label><div class="dialog-actions"><button>保存</button></div></dialog>
        </main></body></html>`,
          }),
        );
        await page.goto("https://renderer.invalid/");
        const result = await page.evaluate(() => {
          const required = <T extends Element>(element: T | null): T => {
            if (!element) throw new Error("Missing layout fixture element");
            return element;
          };
          const rect = (element: Element) => element.getBoundingClientRect();
          const gaps = [
            ...document.querySelectorAll(
              ".inline-form,.filter-bar,.actions-group",
            ),
          ].flatMap((form) => {
            const children = [...form.children];
            return children.slice(1).map((child, index) => {
              const previous = children[index];
              if (!previous) throw new Error("Missing preceding control");
              const before = rect(previous),
                after = rect(child);
              return after.top >= before.bottom
                ? after.top - before.bottom
                : after.left - before.right;
            });
          });
          const pdf = required(
              document.querySelector<HTMLButtonElement>("#pdf"),
            ),
            svg = required(document.querySelector<HTMLDetailsElement>("#svg")),
            before = rect(pdf).height;
          svg.open = true;
          const heightDifference = rect(pdf).height - before;
          const button = required(
              document.querySelector<HTMLButtonElement>(".code-copy"),
            ),
            pre = required(document.querySelector("pre")),
            code = required(pre.querySelector("code"));
          pre.scrollLeft = 200;
          const copyOutside = !pre.contains(button),
            copyBeforeCode = rect(button).bottom <= rect(code).top;
          const dialog = required(document.querySelector("dialog"));
          dialog.showModal();
          const bounds = rect(dialog),
            close = rect(required(dialog.querySelector(".dialog-close")));
          const hidden = getComputedStyle(
            required(dialog.querySelector("[hidden]")),
          ).display;
          dialog.close();
          const cell = required(document.querySelector("td.actions-cell"));
          return {
            gaps,
            heightDifference,
            copyOutside,
            copyBeforeCode,
            dialog: { left: bounds.left, right: bounds.right },
            close: { width: close.width, height: close.height },
            hidden,
            overflow: document.documentElement.scrollWidth > innerWidth,
            cellDisplay: getComputedStyle(cell).display,
            lastRowDivider: getComputedStyle(
              required(document.querySelector("tbody tr:last-child td")),
            ).borderBottomWidth,
            technicalWhitespace: getComputedStyle(
              required(document.querySelector(".job-technical code")),
            ).whiteSpace,
            emptyMargin: getComputedStyle(
              required(document.querySelector("#app-error")),
            ).marginTop,
          };
        });
        for (const gap of result.gaps) expect(gap).toBeGreaterThanOrEqual(8);
        expect(result.heightDifference).toBe(0);
        expect(result.copyOutside).toBe(true);
        expect(result.copyBeforeCode).toBe(true);
        expect(result.dialog.left).toBeGreaterThanOrEqual(7);
        expect(result.dialog.right).toBeLessThanOrEqual(width - 7);
        expect(result.close.width).toBeGreaterThanOrEqual(44);
        expect(result.close.height).toBeGreaterThanOrEqual(44);
        expect(result.hidden).toBe("none");
        expect(result.overflow).toBe(false);
        expect(result.cellDisplay).toBe(width > 860 ? "table-cell" : "block");
        if (width <= 860) expect(result.lastRowDivider).toBe("1px");
        expect(result.technicalWhitespace).toBe("pre-wrap");
        expect(result.emptyMargin).toBe("0px");
        await page.locator("#disabled").hover();
        expect(
          await page
            .locator("#disabled")
            .evaluate((button) => getComputedStyle(button).filter),
        ).toBe("none");
      } finally {
        await page.close();
      }
    },
  );
});
