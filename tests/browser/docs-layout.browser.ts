import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { renderPublicDoc } from "../../apps/admin-web/src/markdown-docs.js";
import { siteScript } from "../../apps/admin-web/src/assets/site-script.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser?.close();
});

it.each([390, 768, 821, 960, 1100, 1200])(
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
      "Web／APIへsudo権限やGitHub tokenを渡しません",
    );
  } finally {
    await page.close();
  }
});
