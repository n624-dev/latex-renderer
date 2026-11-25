import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { routeWebFonts } from "../helpers/browser-web-fonts.js";
import {
  publicDocsSearchJson,
  renderPublicDoc,
} from "../../apps/admin-web/src/markdown-docs.js";
import { siteScript } from "../../apps/admin-web/src/assets/site-script.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser?.close();
});

it.each([320, 390, 768, 821, 960, 1100, 1200])(
  "keeps document navigation accessible at %ipx",
  async (width) => {
    if (!browser) throw new Error("Browser not started");
    const page = await newTestPage(browser, {
      viewport: { width, height: 900 },
    });
    try {
      await page.route("https://renderer.invalid/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        const resource =
          path === "/assets/site.js"
            ? { contentType: "text/javascript", body: siteScript }
            : path === "/assets/styles.css"
              ? { contentType: "text/css", body: styles }
              : { contentType: "text/html", body: renderPublicDoc("index") };
        return route.fulfill(resource);
      });
      await routeWebFonts(page, "https://renderer.invalid");
      await page.goto("https://renderer.invalid/docs/");
      const menu = page.locator(".docs-menu");
      expect(
        await menu.evaluate((element) => (element as HTMLDetailsElement).open),
      ).toBe(width > 820);
      if (width <= 820) {
        await menu.locator("summary").click();
        expect(await menu.locator('a[href="/docs/web/"]').isVisible()).toBe(
          true,
        );
        await menu.locator("summary").click();
        expect(await menu.locator('a[href="/docs/web/"]').isVisible()).toBe(
          false,
        );
      }
      const layout = await page.evaluate(() => {
        const article = document.querySelector(".docs-content");
        const metadata = document.querySelector(".docs-meta");
        if (!article || !metadata) throw new Error("Missing document content");
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          metadataAfterArticle:
            metadata.getBoundingClientRect().top >=
            article.getBoundingClientRect().bottom,
          hasDecorativeHeading: document.querySelector(".eyebrow") !== null,
        };
      });
      expect(layout).toEqual({
        overflow: false,
        metadataAfterArticle: true,
        hasDecorativeHeading: false,
      });
      await page.setViewportSize({
        width: width > 820 ? 390 : 1200,
        height: 900,
      });
      // A viewport change updates matchMedia asynchronously.
      await page.waitForFunction((expected) => {
        const element =
          document.querySelector<HTMLDetailsElement>(".docs-menu");
        return element?.open === expected;
      }, width <= 820);
    } finally {
      await page.close();
    }
  },
);

it("opens relocated technical details for an existing heading fragment", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser, {
    viewport: { width: 960, height: 900 },
  });
  try {
    await page.route("https://renderer.invalid/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill(
        path === "/assets/site.js"
          ? { contentType: "text/javascript", body: siteScript }
          : path === "/assets/styles.css"
            ? { contentType: "text/css", body: styles }
            : { contentType: "text/html", body: renderPublicDoc("reference") },
      );
    });
    const id = "v1-2-xのroot-updaterから権限分離updaterへ移行する場合";
    await routeWebFonts(page, "https://renderer.invalid");
    await page.goto(
      `https://renderer.invalid/docs/reference/#${encodeURIComponent(id)}`,
    );
    expect(await page.locator(`[id="${id}"]`).isVisible()).toBe(true);
    expect(
      await page.locator(`[id="${id}"]`).evaluate((node) => {
        const bounds = node.getBoundingClientRect();
        return bounds.top >= 0 && bounds.top < innerHeight;
      }),
    ).toBe(true);
    expect(await page.locator(".docs-content").textContent()).toContain(
      "Web や API に sudo 権限や GitHub トークンを渡しません",
    );
  } finally {
    await page.close();
  }
});

it("keeps dense API examples usable and searchable on a small screen", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser, {
    viewport: { width: 320, height: 700 },
  });
  try {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: (value: string) => {
            document.body.dataset.copiedExample = value;
            return Promise.resolve();
          },
        },
      });
    });
    await page.route("https://renderer.invalid/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/assets/site.js")
        return route.fulfill({
          contentType: "text/javascript",
          body: siteScript,
        });
      if (path === "/assets/styles.css")
        return route.fulfill({ contentType: "text/css", body: styles });
      if (path === "/assets/docs-search.json")
        return route.fulfill({
          contentType: "application/json",
          body: publicDocsSearchJson(),
        });
      return route.fulfill({
        contentType: "text/html",
        body: renderPublicDoc("api"),
      });
    });

    await routeWebFonts(page, "https://renderer.invalid");
    await page.goto("https://renderer.invalid/docs/api/");
    const toc = page.locator(".docs-toc");
    const curl = toc.getByRole("link", { name: "curlの例" });
    expect(await curl.isVisible()).toBe(false);
    await toc.getByText("ページ内目次", { exact: true }).click();
    await curl.click();

    const example = page.locator(".docs-details").filter({
      hasText: "ZIP を送信して PDF を取得する例を表示",
    });
    await example.locator("summary").click();
    await example.getByRole("button", { name: "コピー", exact: true }).click();
    await page.waitForFunction(() =>
      document.body.dataset.copiedExample?.includes("--output result.pdf"),
    );

    const dimensions = await page.evaluate(() => {
      const table = document.querySelector<HTMLElement>(".table-wrap");
      const code = Array.from(document.querySelectorAll("pre")).find((pre) =>
        pre.textContent.includes("--output result.pdf"),
      );
      if (!table || !code) throw new Error("Missing API content");
      return {
        pageFits: document.documentElement.scrollWidth <= innerWidth,
        tableScrolls: table.scrollWidth > table.clientWidth,
        codeScrolls: code.scrollWidth > code.clientWidth,
        tableFocusable: table.tabIndex === 0,
        codeFocusable: code.tabIndex === 0,
      };
    });
    expect(dimensions).toEqual({
      pageFits: true,
      tableScrolls: true,
      codeScrolls: true,
      tableFocusable: true,
      codeFocusable: true,
    });

    await page
      .getByRole("searchbox", { name: "ガイド内を検索" })
      .fill("CLI インストール");
    const firstResult = page.locator("#docs-search-results a").first();
    expect(await firstResult.getAttribute("href")).toBe("/docs/client/");
  } finally {
    await page.close();
  }
});
