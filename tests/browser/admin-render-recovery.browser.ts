import { execFileSync } from "node:child_process";
import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { adminRenderPage } from "../../apps/admin-web/src/templates-admin.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";
import { siteScript } from "../../apps/admin-web/src/assets/site-script.js";
import { zipStoredFiles } from "../../apps/admin-web/src/assets/render-script.js";

// Exercise the shipped stringified script, not a separately reimplemented UI.
const script = execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    "const m=await import(process.argv[1]);process.stdout.write(m.renderScript)",
    new URL(
      "../../apps/admin-web/dist/assets/render-script.js",
      import.meta.url,
    ).href,
  ],
  { encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
);
const origin = "https://renderer.invalid";
const sourceId = `source_${"a".repeat(32)}`;
let browser: Browser | undefined;
const pages: Page[] = [];
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterEach(async () => {
  await Promise.all(pages.splice(0).map((page) => page.close()));
});
afterAll(async () => {
  await browser?.close();
});

it.each([true, false])(
  "restores every input after a shared Source batch (reservation failure: %s)",
  async (failSource) => {
    if (!browser) throw new Error("Browser not started");
    const page = await newTestPage(browser, {
      viewport: { width: 390, height: 844 },
    });
    page.setDefaultTimeout(5_000);
    pages.push(page);
    const errors: string[] = [];
    let reservations = 0,
      jobs = 0;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === "/favicon.ico")
        return route.fulfill({ status: 204 });
      if (url.pathname === "/admin/render")
        return route.fulfill({
          contentType: "text/html",
          body: adminRenderPage(),
        });
      if (url.pathname === "/admin/assets/styles.css")
        return route.fulfill({ contentType: "text/css", body: styles });
      if (url.pathname === "/admin/assets/site.js")
        return route.fulfill({
          contentType: "application/javascript",
          body: siteScript,
        });
      if (url.pathname === "/admin/assets/render.js")
        return route.fulfill({
          contentType: "application/javascript",
          body: script,
        });
      if (url.pathname === "/auth/session")
        return route.fulfill({ json: { csrfToken: "fixture-csrf" } });
      if (url.pathname.endsWith("/render-targets"))
        return route.fulfill({
          json: {
            items: [
              {
                apiKeyId: "key_fixture",
                apiKeyName: "Fixture",
                serviceAccountId: "sa_fixture",
                serviceAccountName: "Fixture",
                userId: "user_fixture",
                userLabel: "Fixture",
              },
            ],
          },
        });
      if (url.pathname.endsWith("/source-tickets")) {
        reservations++;
        return route.fulfill(
          failSource
            ? {
                status: 503,
                json: {
                  error: {
                    code: "MAINTENANCE",
                    message: "Fixture reservation failure",
                  },
                },
              }
            : {
                json: {
                  sourceId,
                  uploadRequired: true,
                  uploadTicket: "fixture-source-ticket",
                  uploadUrl: `${origin}/api/v1/sources/${sourceId}/content`,
                  expiresAt: "2099-01-01T00:00:00Z",
                },
              },
        );
      }
      if (request.method() === "PUT") return route.fulfill({ status: 204 });
      if (url.pathname.endsWith("/render-tickets")) {
        const jobId = `job_${String(++jobs).padStart(32, "0")}`;
        return route.fulfill({
          json: {
            jobId,
            jobTicket: "fixture-job-ticket",
            expiresAt: "2099-01-01T00:00:00Z",
          },
        });
      }
      if (/^\/api\/v1\/jobs\/job_[a-f0-9]{32}$/.test(url.pathname))
        return route.fulfill({
          json: {
            id: url.pathname.split("/").at(-1),
            status: "succeeded",
            errorCode: null,
            errorMessage: null,
            retentionExpiresAt: null,
            artifacts: [],
            previews: [],
          },
        });
      errors.push(`Unexpected fixture request ${url.pathname}`);
      return route.abort();
    });
    await page.goto(`${origin}/admin/render`);
    const document = Buffer.from(
      "\\documentclass{article}\\begin{document}Fixture\\end{document}",
    );
    await page.locator("#project-files").setInputFiles({
      name: "project.zip",
      mimeType: "application/zip",
      buffer: Buffer.from(
        zipStoredFiles(
          ["a.tex", "b.tex"].map((name) => ({ name, bytes: document })),
        ),
      ),
    });
    await page.locator("#inspect-files").click();
    await page.locator("#render-target").selectOption("key_fixture");
    await expect
      .poll(() => page.locator("#start-render").isEnabled())
      .toBe(true);
    await page.locator("#start-render").click();
    await expect.poll(() => reservations).toBe(1);
    if (failSource)
      await expect
        .poll(() => page.locator("#render-items").innerText())
        .toContain("Fixture reservation failure");
    else {
      await expect.poll(() => jobs).toBe(2);
      await expect
        .poll(() => page.locator("#render-status").textContent())
        .toBe("すべての処理が終了しました。");
    }
    for (const selector of [
      "#project-files",
      "#project-directory",
      "#render-target",
    ])
      await expect.poll(() => page.locator(selector).isEnabled()).toBe(true);
    await page.locator("#project-files").setInputFiles({
      name: "next.tex",
      mimeType: "application/x-tex",
      buffer: document,
    });
    await expect
      .poll(() => page.locator("#inspect-files").isEnabled())
      .toBe(true);
    expect(errors).toEqual([]);
  },
);
