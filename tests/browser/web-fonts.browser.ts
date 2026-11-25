import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEditorBrowserFixture } from "../fixtures/editor-browser-server.mjs";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";

let browser: Browser | undefined;
let fixture: Awaited<ReturnType<typeof startEditorBrowserFixture>> | undefined;

beforeAll(async () => {
  fixture = await startEditorBrowserFixture();
  browser = await launchTestBrowser();
});

afterAll(async () => {
  await browser?.close();
  await fixture?.close();
});

describe("Language-specific Web fonts", () => {
  it.each([
    ["en", undefined],
    ["ja", "jp"],
    ["zh-CN", "sc"],
    ["ko", "kr"],
  ])("loads the %s fallback from the same origin", async (locale, region) => {
    if (!browser || !fixture) throw new Error("Web fixture did not start");
    const origin = fixture.origin;
    const page = await newTestPage(browser);
    try {
      const requested = new Set<string>();
      page.on("request", (request) => {
        const url = new URL(request.url());
        if (url.pathname.startsWith("/assets/fonts/")) requested.add(url.href);
      });
      await page.route("**/assets/styles.css", async (route) => {
        const response = await route.fetch();
        const style = (await response.text())
          .replace('"Inter Variable", Inter, "Inter Web"', '"Inter Web"')
          .replace(/"Noto Sans (?:CJK )?(?:JP|SC|KR)", /g, "");
        await route.fulfill({ response, body: style });
      });
      await page.goto(origin + `/${locale}/`);
      const loaded = await page.evaluate(async () => {
        await document.fonts.ready;
        return [...document.fonts]
          .filter((face) => face.status === "loaded")
          .map((face) => face.family.replaceAll('"', ""));
      });
      const assets = [...requested].map((href) => new URL(href));
      expect(assets.every((url) => url.origin === origin)).toBe(true);
      expect(loaded).toContain("Inter Web");
      const names = assets.map((url) => url.pathname.split("/").at(-1));
      expect(names.some((name) => name?.startsWith("inter-normal-"))).toBe(
        true,
      );
      const regional = names.filter((name) => name?.startsWith("noto-"));
      if (region) {
        expect(loaded).toContain(`Noto Sans ${region.toUpperCase()} Web`);
        expect(regional.some((name) => name?.endsWith(".woff2"))).toBe(true);
        expect(
          regional.every(
            (name) =>
              name?.startsWith(`noto-${region}.`) ||
              name?.startsWith(`noto-${region}-`),
          ),
        ).toBe(true);
      } else expect(regional).toEqual([]);
      expect(await page.locator("html").getAttribute("lang")).toBe(locale);
    } finally {
      await page.close();
    }
  });
});
