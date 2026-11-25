import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import type { ClientDistribution } from "../../apps/admin-web/src/client-distribution.js";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";

const origin = "http://127.0.0.1:43171";
let app: ReturnType<
  typeof import("../../apps/admin-web/src/app.js").createWebApp
>;

let browser: Browser | undefined;
let savedLanguage: string | null;
const scripts = new Map<string, string>();

beforeAll(async () => {
  const appPath = new URL("../../apps/admin-web/dist/app.js", import.meta.url)
    .href;
  const { createWebApp } = (await import(
    appPath
  )) as typeof import("../../apps/admin-web/src/app.js");
  app = createWebApp({
    archive: new Uint8Array(),
    archiveName: "test.zip",
    version: "1.0.0",
  } as ClientDistribution);
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser?.close();
});

async function openPage(locale: string) {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser, {
    locale,
    viewport: { width: 375, height: 800 },
  });
  await page.route(origin + "/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    switch (url.pathname) {
      case "/app/assets/app.js": {
        const locale = url.searchParams.get("locale") ?? "en";
        let script = scripts.get(locale);
        if (script === undefined) {
          script = execFileSync(
            process.execPath,
            [
              "--input-type=module",
              "--eval",
              "const module = await import(process.argv[1]); process.stdout.write(module.localizedAppScript(process.argv[2]));",
              new URL(
                "../../apps/admin-web/dist/assets/app-script.js",
                import.meta.url,
              ).href,
              locale,
            ],
            { encoding: "utf8", timeout: 10_000 },
          );
          scripts.set(locale, script);
        }
        return route.fulfill({ contentType: "text/javascript", body: script });
      }
      case "/auth/config":
        return route.fulfill({
          json: { methods: [{ id: "password" }], backend: "native" },
        });
      case "/auth/session":
        return route.fulfill({ json: { csrfToken: "test-csrf" } });
      case "/app/api/v1/me":
        return route.fulfill({
          json: {
            isAdmin: false,
            displayLocale: savedLanguage,
            resolvedDisplayLocale: savedLanguage ?? "en",
          },
        });
      case "/app/api/v1/me/locale":
        expect(request.method()).toBe("PATCH");
        expect(request.headers()["x-csrf-token"]).toBe("test-csrf");
        savedLanguage = (request.postDataJSON() as { locale: string }).locale;
        return route.fulfill({ json: { displayLocale: savedLanguage } });
      case "/app/api/v1/projects":
        return route.fulfill({ json: { items: [], hasMore: false } });
    }
    const response = await app.request(request.url(), {
      headers: await request.allHeaders(),
      redirect: "manual",
    });
    await route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
  return page;
}

describe("Display language in the browser", () => {
  it("switches guide language, follows legacy fragments and searches in the selected language", async () => {
    const page = await openPage("fr");
    try {
      await page.goto(origin + "/en/docs/web/#edit-a-project");
      expect(await page.locator("#edit-a-project").count()).toBe(1);
      await page.locator(".language-picker summary").click();
      await page.locator(".language-picker a[lang=fr]").click();
      expect(new URL(page.url()).pathname).toBe("/fr/docs/web/");
      expect(await page.locator("html").getAttribute("lang")).toBe("fr");
      await page.locator("#docs-search").fill("PDF");
      await page.locator("#docs-search-results a").first().waitFor();
      expect(
        await page
          .locator("#docs-search-results a")
          .first()
          .getAttribute("href"),
      ).toMatch(/^\/fr\/docs\//);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(375);
    } finally {
      await page.close();
    }
  });

  it("falls back to English and applies an account language in a second browser", async () => {
    savedLanguage = null;
    const first = await openPage("ar");
    try {
      await first.goto(origin + "/");
      expect(await first.locator("html").getAttribute("lang")).toBe("en");
      await first.goto(origin + "/app/projects/");
      await first.getByText("No projects yet.", { exact: true }).waitFor();
      await first.locator(".language-picker summary").click();
      await first.locator(".language-picker a[lang=de]").click();
      await first.waitForFunction(
        () => document.documentElement.lang === "de",
        undefined,
        { timeout: 7_000 },
      );
      await first.waitForURL(origin + "/app/projects/", { timeout: 7_000 });
      expect(savedLanguage).toBe("de");
      expect(await first.locator("html").getAttribute("lang")).toBe("de");
    } finally {
      await first.close();
    }
    const second = await openPage("ja");
    try {
      await second.goto(origin + "/app/projects/");
      await second.waitForFunction(
        () => document.documentElement.lang === "de",
        undefined,
        { timeout: 7_000 },
      );
      expect(await second.locator("h1").textContent()).toBe("Projekte");
      await second.goto(origin + "/app/projects/?locale=fr");
      await second.waitForURL(origin + "/app/projects/", { timeout: 7_000 });
      expect(await second.locator("html").getAttribute("lang")).toBe("fr");
      expect(savedLanguage).toBe("de");
    } finally {
      await second.close();
    }
  });
});
