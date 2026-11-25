import { expect, it } from "vitest";
import { startEditorBrowserFixture } from "../fixtures/editor-browser-server.mjs";
import {
  browserSettings,
  launchTestBrowser,
} from "../helpers/browser-engine.js";

it.skipIf(browserSettings().engine !== "chromium")(
  "keeps active composition across a display language change",
  async () => {
    const browser = await launchTestBrowser();
    let fixture:
      Awaited<ReturnType<typeof startEditorBrowserFixture>> | undefined;
    try {
      fixture = await startEditorBrowserFixture();
      const { state } = fixture;
      const context = await browser.newContext({ locale: "ja" });
      const page = await context.newPage();
      let compiles = 0;
      await page.route("**/api/v1/me/locale", (route) =>
        route.fulfill({ json: { displayLocale: "de" } }),
      );
      page.on("request", (request) => {
        if (request.method() === "POST" && request.url().endsWith("/preview"))
          compiles++;
      });
      await page.goto(fixture.origin + fixture.editorPath);
      await expect
        .poll(() => page.locator("#editor-language").isEnabled())
        .toBe(true);
      await page.locator("#editor-build").click();
      await expect
        .poll(() => page.locator("#editor-preview-status").textContent())
        .toBe("コンパイル完了");
      const source = page.locator(".cm-content");
      await source.press("End");
      const protocol = await context.newCDPSession(page);
      await protocol.send("Input.imeSetComposition", {
        text: "日本語",
        selectionStart: 3,
        selectionEnd: 3,
      });
      await expect.poll(() => source.textContent()).toContain("日本語");
      await page
        .locator("#editor-language")
        .evaluate((select) => {
          if (!(select instanceof HTMLSelectElement))
            throw new Error("Language picker is not a select element");
          select.value = "de";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
      await expect
        .poll(() => page.locator("#app-editor").getAttribute("lang"))
        .toBe("de");
      expect(await source.textContent()).toContain("日本語");
      expect(state.version).toBe(1);
      expect(compiles).toBe(1);
      await protocol.send("Input.insertText", { text: "日本語" });
      await expect
        .poll(() => state.text, { timeout: 6_000 })
        .toContain("日本語");
      expect(state.text.match(/日本語/g)).toEqual(["日本語"]);
      await expect.poll(() => compiles, { timeout: 6_000 }).toBe(2);
    } finally {
      await browser.close();
      await fixture?.close();
    }
  },
);
