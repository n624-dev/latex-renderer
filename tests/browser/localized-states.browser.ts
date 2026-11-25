import type { Browser, Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { displayLocales } from "../../packages/shared/src/locale.js";
import { siteCatalog } from "../../apps/admin-web/src/site-messages.js";
import { startServerSetupWeb } from "../../deploy/scripts/server-setup-web.mjs";
import { setupTexts } from "../../deploy/scripts/setup-messages.mjs";
import { importServerSetupReview } from "../../packages/server-setup-core/src/index.mjs";
import { startEditorBrowserFixture } from "../fixtures/editor-browser-server.mjs";
import {
  browserSettings,
  launchTestBrowser,
  newTestPage,
} from "../helpers/browser-engine.js";

const editorModule = new URL(
  "../../apps/admin-web/dist/editor/messages.js",
  import.meta.url,
);
const setupFixture = () =>
  importServerSetupReview(
    [
      "DEPLOYMENT_MODE=standalone",
      "AUTH_MODE=password",
      "PUBLIC_ORIGIN=https://renderer.example.test",
      "RENDERER_PUBLIC_URL=https://renderer.example.test",
      "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3",
      "STORAGE_ROOT=/var/lib/latex-renderer/storage",
      `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
      "",
    ].join("\n"),
  );

async function assertFitsAt200Percent(page: Page, control: string) {
  await page.setViewportSize({ width: 750, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  const rect = await page.locator(control).boundingBox();
  if (!rect) throw new Error(`Missing visible control: ${control}`);
  expect(rect.x).toBeGreaterThanOrEqual(0);
  expect(rect.x + rect.width).toBeLessThanOrEqual(751);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

describe.skipIf(browserSettings().engine !== "chromium")(
  "Localized error and recovery states",
  () => {
    let browser: Browser;
    beforeAll(async () => {
      browser = await launchTestBrowser();
    });
    afterAll(async () => {
      await browser.close();
    });

    it.each(displayLocales)(
      "%s shows login failure, compile failure, edit conflict and setup recovery",
      async (locale) => {
        const fixture = await startEditorBrowserFixture({
          saveConflict: true,
          renderFailure: true,
        });
        const page = await newTestPage(browser, {
          locale,
          viewport: { width: 375, height: 800 },
        });
        page.setDefaultTimeout(6000);
        const webErrors: string[] = [];
        page.on("pageerror", (error) => webErrors.push(error.message));
        let setup: Awaited<ReturnType<typeof startServerSetupWeb>> | undefined;
        try {
          await page.goto(fixture.origin + "/login/");
          expect(await page.locator("html").getAttribute("lang")).toBe(locale);
          await page.locator("[name=loginName]").fill("fixture-user");
          await page.locator("[name=password]").fill("fixture-password");
          await page.locator("#password-login button").click();
          await expect
            .poll(() => page.locator("#login-message").textContent())
            .toBe(siteCatalog(locale).signInError);
          await assertFitsAt200Percent(page, "#password-login button");

          await page.setViewportSize({ width: 375, height: 800 });
          await page.goto(fixture.origin + fixture.editorPath);
          const { loadEditorCatalog } = (await import(
            editorModule.href
          )) as typeof import("../../apps/admin-web/src/editor/messages.js");
          const { messages } = await loadEditorCatalog(locale);
          await page.locator("#editor-build").click();
          await expect
            .poll(() => page.locator("#editor-preview-status").textContent())
            .toBe(messages.failed);
          await page.locator(".cm-content").focus();
          await page.locator('[data-editor-dialog="editor-file-dialog"]').click();
          await page.locator('[data-insert="%"]').click();
          await page.locator("#editor-build").click();
          await expect
            .poll(() => page.locator("#editor-save-status").textContent(), {
              timeout: 7_000,
            })
            .toBe(messages.conflict);
          expect(fixture.state.version).toBe(1);
          expect(await page.locator(".cm-content").textContent()).toContain(
            "%",
          );
          await assertFitsAt200Percent(page, "#editor-save-status");

          let recovered = false;
          setup = await startServerSetupWeb({
            current: setupFixture,
            preview: (review) => ({ review }),
            apply: () => {
              throw new Error("fixture-only private error");
            },
            recover: () => {
              recovered = true;
              return { committed: true };
            },
          });
          await page.setViewportSize({ width: 375, height: 800 });
          await page.goto(setup.bootstrapUrl);
          const setupMessages = setupTexts(locale) as {
            applyUnconfirmed: string;
            recovered: string;
            recoverInterruptedSetup: string;
          };
          expect(await page.locator("html").getAttribute("lang")).toBe(locale);
          await page.locator("#settings button[type=submit]").click();
          await page.locator("#apply").click();
          const status = page.locator("#status");
          await expect
            .poll(() => status.textContent())
            .toBe(setupMessages.applyUnconfirmed);
          expect(await page.locator("#recover").textContent()).toBe(
            setupMessages.recoverInterruptedSetup,
          );
          await assertFitsAt200Percent(page, "#recover");
          await page.locator("#recover").click();
          await expect
            .poll(() => status.textContent())
            .toBe(setupMessages.recovered);
          expect(recovered).toBe(true);
          expect(webErrors).toEqual([]);
        } finally {
          await page.close();
          setup?.close();
          await setup?.closed;
          await fixture.close();
        }
      },
    );
  },
);
