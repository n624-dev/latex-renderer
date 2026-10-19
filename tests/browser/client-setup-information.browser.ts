import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import {
  setupHtml,
  setupCss,
  setupJavaScript,
} from "../../packages/setup-web/src/assets.js";

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser?.close();
});

it.each([390, 768, 1200])(
  "shows human diagnostics with optional raw data at %ipx",
  async (width) => {
    if (!browser) throw new Error("Browser not started");
    const page = await newTestPage(browser, {
      viewport: { width, height: 844 },
    });
    // Exercise the shipped UI without building unrelated client workspaces or
    // contacting a renderer. HTTP authentication boundaries have separate tests.
    const origin = "https://renderer.invalid";
    await page.route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/assets/setup.css") {
        await route.fulfill({ contentType: "text/css", body: setupCss });
        return;
      }
      if (path === "/assets/setup.js") {
        await route.fulfill({
          contentType: "text/javascript",
          body: setupJavaScript,
        });
        return;
      }
      if (path === "/") {
        await route.fulfill({ contentType: "text/html", body: setupHtml });
        return;
      }
      const results: Record<string, unknown> = {
        "/api/session": {
          sessionToken: "fixture-session",
          csrfToken: "fixture-csrf",
        },
        "/api/status": { status: "healthy" },
        "/api/doctor": {
          status: "degraded",
          checks: [
            {
              id: "credential.store",
              status: "warn",
              message: "Fixture credential warning",
            },
          ],
        },
        "/api/sample-render": {
          job: { status: "failed", errorMessage: "<b>Fixture failure</b>" },
        },
      };
      if (!(path in results)) {
        await route.abort();
        return;
      }
      await route.fulfill({ json: { success: true, result: results[path] } });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(`${origin}/#fixture-bootstrap`);
      await page.waitForFunction(() =>
        document
          .querySelector("#status-summary")
          ?.textContent.includes("要確認"),
      );
      expect(await page.locator("#status").isVisible()).toBe(false);
      expect(await page.locator("#status-summary").textContent()).toContain(
        "認証情報: 注意",
      );
      expect(await page.locator(".eyebrow").count()).toBe(0);
      await page.locator("#sample").click();
      await page.waitForFunction(() =>
        document
          .querySelector("#result-summary")
          ?.textContent.includes("Fixture failure"),
      );
      expect(await page.locator("#result-summary").textContent()).toContain(
        "失敗",
      );
      expect(await page.locator("#result-summary b").count()).toBe(0);
      expect(await page.locator("#result").isVisible()).toBe(false);
      for (const zoom of ["1", "2"]) {
        await page.evaluate((value) => {
          document.documentElement.style.zoom = value;
        }, zoom);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      }
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  },
);
