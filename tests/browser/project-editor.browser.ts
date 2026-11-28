import { localizedAppScript } from "../../apps/admin-web/src/assets/localized-app-script.js";
import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import {
  browserSettings,
  launchTestBrowser,
  newTestPage,
} from "../helpers/browser-engine.js";
import type { ClientDistribution } from "../../apps/admin-web/src/client-distribution.js";

const origin = "http://127.0.0.1:43128";
const projectId = `project_${"a".repeat(32)}`;
const jobId = `job_${"1".repeat(32)}`;
const failedJobId = `job_${"2".repeat(32)}`;
const editorPath = `/app/projects/${projectId}/edit/`;
const draftPath = `/app/api/v1/projects/${projectId}/draft`;
const appScript = localizedAppScript("ja");
let browser: Browser | undefined;

beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser?.close();
});

function fixturePdf() {
  const content = "0 0 0 rg\n10 10 50 50 re f\n";
  const padding = "unused image data\n".repeat(90000);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 2 /Kids [3 0 R 6 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
    `<< /Length ${padding.length} >>\nstream\n${padding}endstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = objects.map((item, index) => {
    const offset = output.length;
    output += `${index + 1} 0 obj\n${item}\nendobj\n`;
    return offset;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output);
}

describe("Project editor", () => {
  it("lazily loads the editor and PDF worker, then keeps the last PDF on a failed build", async () => {
    const appPath = new URL("../../apps/admin-web/dist/app.js", import.meta.url)
      .href;
    const { createWebApp } = (await import(
      appPath
    )) as typeof import("../../apps/admin-web/src/app.js");
    const app = createWebApp({
      archive: new Uint8Array(),
    } as ClientDistribution);
    const editorPage = await app.request(origin + editorPath);
    expect(editorPage.headers.get("Cache-Control")).toContain("no-store");
    const entrypoint = (await editorPage.text()).match(
      /data-editor-entrypoint="(\/app\/assets\/editor\/[a-f0-9]{64}\/editor\.js)"/,
    )?.[1];
    if (!entrypoint) throw new Error("Missing versioned editor entrypoint");
    const assetRoot = entrypoint.slice(0, -"editor.js".length);
    const assetUrl = origin + entrypoint;
    const encoded = await app.request(assetUrl, {
      headers: { "Accept-Encoding": "gzip" },
    });
    const plain = await app.request(assetUrl, {
      headers: { "Accept-Encoding": "gzip;q=0" },
    });
    expect(encoded.headers.get("content-encoding")).toBe("gzip");
    expect(encoded.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(encoded.headers.get("pragma")).toBeNull();
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(Number(encoded.headers.get("content-length"))).toBeLessThan(
      Number(plain.headers.get("content-length")),
    );
    await encoded.body?.cancel();
    await plain.body?.cancel();
    for (const path of [
      entrypoint.replace(/[a-f0-9]{64}/, "0".repeat(64)),
      assetRoot + "version.txt",
    ]) {
      const missing = await app.request(origin + path);
      expect(missing.status).toBe(404);
      expect(missing.headers.get("Cache-Control")).toContain("no-store");
    }
    const css = await app.request(origin + assetRoot + "styles.css");
    expect(css.headers.get("Content-Type")).toContain("text/css");
    expect(css.headers.get("Cache-Control")).toContain("immutable");
    await css.body?.cancel();
    if (browser === undefined) throw new Error("Test browser did not start");
    const page = await newTestPage(browser);
    page.setDefaultTimeout(8_000);
    const observed: string[] = [],
      failures: string[] = [],
      failedRequests: string[] = [];
    const pdf = fixturePdf(),
      ranges: number[] = [];
    const pdfPath = `/app/api/v1/jobs/${jobId}/artifacts/result.pdf`;
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC",
      "base64",
    );
    const browserCss = await app.request(origin + assetRoot + "styles.css");
    const cssBytes = Buffer.from(await browserCss.arrayBuffer());
    let initialBytes = 0,
      cssRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      if (request.url === assetRoot + "styles.css") {
        cssRequests++;
        response
          .writeHead(browserCss.status, Object.fromEntries(browserCss.headers))
          .end(cssBytes);
        return;
      }
      if (request.url?.startsWith("/cache-check/")) {
        response
          .writeHead(200, { "Content-Type": "text/html" })
          .end(
            `<!doctype html><link rel="stylesheet" href="${assetRoot}styles.css">`,
          );
        return;
      }
      if (request.url?.split("?")[0] !== pdfPath) {
        response.writeHead(404).end();
        return;
      }
      const headers = {
        "Content-Type": "application/pdf",
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store, no-transform",
      };
      const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? "");
      if (match) {
        const start = Number(match[1]),
          end = Number(match[2]);
        const chunk = pdf.subarray(start, end + 1);
        ranges.push(chunk.length);
        response
          .writeHead(206, {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${pdf.length}`,
            "Content-Length": chunk.length,
          })
          .end(chunk);
        return;
      }
      response.writeHead(200, { ...headers, "Content-Length": pdf.length });
      response.flushHeaders();
      let offset = 0;
      const timer = setInterval(() => {
        const chunk = pdf.subarray(offset, offset + 16384);
        offset += chunk.length;
        initialBytes += chunk.length;
        if (offset >= pdf.length) response.end(chunk);
        else response.write(chunk);
      }, 20);
      response.on("close", () => clearInterval(timer));
    });
    server.listen(43128, "127.0.0.1");
    await once(server, "listening");
    try {
      let savedOutputs: unknown;
      let version = 1,
        text = "Original",
        fail = false,
        running = false,
        posts = 0,
        replacements = 0,
        retiredPdfAssets = false,
        locale = "ja";
      let previewGate: Promise<void> | undefined;
      const failedJobStatus = () => (running ? "running" : "failed");
      const draft = () => ({
        version,
        entrypoint: "main.tex",
        engine: "lualatex",
        files: [{ path: "main.tex" }],
      });
      page.on("requestfailed", (request) =>
        failedRequests.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`),
      );
      page.on("pageerror", (error) => failures.push(error.stack ?? error.message));
      page.on("console", (message) => {
        if (message.type() === "error")
          failures.push(`${message.text()} (${message.location().url})`);
      });
      await page.goto(origin + "/cache-check/first");
      await page.goto(origin + "/cache-check/second");
      if (browserSettings().engine === "chromium") expect(cssRequests).toBe(1);
      await page.route("**/*", async (route) => {
        const request = route.request(),
          url = new URL(request.url()),
          path = url.pathname;
        observed.push(path);
        const json = (value: unknown) => route.fulfill({ json: value });
        if (retiredPdfAssets && path.startsWith(assetRoot + "pdf/"))
          return route.fulfill({ status: 404 });
        if (path === "/app/assets/app.js")
          return route.fulfill({
            body: appScript,
            contentType: "text/javascript",
          });
        if (path === "/auth/session") return json({ csrfToken: "fixture" });
        if (path === "/app/api/v1/me")
          return json({ isAdmin: false, resolvedDisplayLocale: locale });
        if (path === "/app/api/v1/me/locale") {
          locale = (request.postDataJSON() as { locale: string }).locale;
          return json({ displayLocale: locale });
        }
        if (path === "/app/api/v1/environment")
          return json({ engines: ["lualatex"] });
        if (path === "/app/api/v1/projects")
          return json({ items: [], hasMore: false });
        if (path === draftPath) return json(draft());
        if (path === draftPath + "/replace") {
          const input = request.postDataJSON() as { version: number };
          expect(input.version).toBe(version);
          replacements++;
          text = "";
          version++;
          return json(draft());
        }
        if (path === draftPath + "/revisions") {
          const saved = request.postDataJSON() as {
            version: number;
            outputs: unknown;
          };
          expect(saved.version).toBe(version);
          savedOutputs = saved.outputs;
          return json({ revisionId: "revision_" + "c".repeat(32) });
        }
        if (path === draftPath + "/file") {
          if (request.method() === "PUT") {
            const data = request.postDataJSON() as {
              version: number;
              text: string;
            };
            if (data.version !== version)
              return route.fulfill({
                status: 409,
                json: { error: { code: "DRAFT_VERSION_CONFLICT", message: "Draft changed" } },
              });
            text = data.text;
            version++;
            return json(draft());
          }
          return json({ text, version });
        }
        if (path === draftPath + "/preview") {
          if (request.method() === "GET") {
            return json({
              latest:
                posts === 0
                  ? null
                  : {
                      jobId: fail ? failedJobId : jobId,
                      version,
                      status: fail ? failedJobStatus() : "succeeded",
                    },
              successful:
                posts === 0 ? null : { jobId, version: 1, pageCount: 2 },
            });
          }
          const requested = request.postDataJSON() as { version: number };
          const held = previewGate;
          posts++;
          if (held) {
            await held;
            return route.fulfill({ status: 503, json: {
              error: { code: "TEMPORARY_FAILURE", message: "Preview unavailable" },
            } });
          }
          return json({
            jobId: fail ? failedJobId : jobId,
            version: requested.version,
          });
        }
        if (path === `/app/api/v1/jobs/${jobId}`)
          return json({ status: "succeeded", pdfPageCount: 2 });
        if (path === `/app/api/v1/jobs/${failedJobId}`)
          return json({ status: failedJobStatus() });
        if (path === `/app/api/v1/jobs/${failedJobId}/artifacts/errors.json`)
          return json({
            success: false,
            exitCode: 1,
            errors: [
              {
                file: "main.tex",
                line: 2,
                message: "Undefined control sequence",
              },
            ],
            warnings: [],
          });
        if (path === pdfPath) return route.continue();
        if (path === `/app/api/v1/jobs/${jobId}/previews/page-1.png`)
          return route.fulfill({
            body: png,
            contentType: "image/png",
          });
        const response = await app.request(url);
        return route.fulfill({
          status: response.status,
          headers: Object.fromEntries(response.headers),
          body: Buffer.from(await response.arrayBuffer()),
        });
      });
      await page.goto(origin + "/app/projects/");
      await expect
        .poll(() => page.locator("#app-projects").textContent(), { timeout: 8000 })
        .toBe("プロジェクトはありません。");
      await page.setViewportSize({ width: 390, height: 780 });
      expect(observed).not.toContain(entrypoint);
      expect(observed.some((path) => path.startsWith(assetRoot + "pdf/"))).toBe(
        false,
      );
      await page.goto(origin + editorPath);
      await page.locator(".cm-content").waitFor({ timeout: 7000 });
      const openOptions = (panel: string) =>
        page.locator(`[data-editor-dialog="editor-${panel}-dialog"]`).click();
      expect(
        await page.locator("#editor-files option:checked").textContent(),
      ).toBe("main.tex");
      for (const id of [
        "editor-cancel",
        "editor-error-tab",
        "editor-engine",
        "editor-upload",
        "editor-save-revision",
        "editor-language",
      ]) {
        expect(await page.locator(`#${id}`).isVisible(), id).toBe(false);
      }
      expect(observed).toContain(entrypoint);
      await expect
        .poll(() => page.locator("#editor-preview-status").textContent(), {
          timeout: 8000,
        })
        .toBe("コンパイル完了");
      expect(observed.some((path) => path.startsWith(assetRoot + "pdf/"))).toBe(
        false,
      );
      const pdfStart = performance.now();
      await page.getByRole("button", { name: "PDF", exact: true }).click();
      await page.locator("#editor-canvas:visible").waitFor({ timeout: 9000 });
      const pdfMs = Math.round(performance.now() - pdfStart);
      expect(observed).toContain(assetRoot + "pdf/pdf.worker.mjs");
      const pdfBytes =
        initialBytes + ranges.reduce((sum, size) => sum + size, 0);
      expect(ranges.length).toBeGreaterThan(0);
      expect(pdfBytes).toBeLessThan(pdf.length / 2);
      await page.setViewportSize({ width: 1100, height: 810 });
      expect(observed).toContain(assetRoot + "locales/ja.js");
      expect(
        await page.locator("#editor-canvas").getAttribute("aria-label"),
      ).toBe("PDF 1 / 2");
      expect(await page.locator(".cm-content").isVisible()).toBe(true);
      expect(await page.locator("#editor-panels").isVisible()).toBe(false);
      await page.locator("#editor-next").click();
      await expect
        .poll(() => page.locator("#editor-canvas").getAttribute("aria-label"))
        .toBe("PDF 2 / 2");
      await openOptions("preview");
      await page.locator("#editor-zoom").selectOption("150%");
      await page.keyboard.press("Escape");
      await openOptions("settings");
      await page.locator("#editor-language").selectOption("en");
      await expect
        .poll(() => page.locator("#editor-preview-status").textContent())
        .toBe("Compilation complete");
      expect(await page.locator("#app-editor").getAttribute("lang")).toBe("en");
      expect(await page.locator(".cm-content").textContent()).toBe("Original");
      expect(await page.locator("#editor-canvas").isVisible()).toBe(true);
      expect(await page.locator("#editor-zoom").inputValue()).toBe("150%");
      expect(await page.locator("#editor-canvas").getAttribute("aria-label")).toBe("PDF 2 / 2");
      expect(posts).toBe(1);
      await page.locator("#editor-language").selectOption("ja");
      await expect
        .poll(() => page.locator("#app-editor").getAttribute("lang"))
        .toBe("ja");
      await page.keyboard.press("Escape");
      await openOptions("file");
      await page.locator("#editor-search").click();
      await page.locator(".cm-search input[name=search]").waitFor();
      await page.keyboard.press("Escape");
      await page.locator("#editor-prev").click();
      await expect
        .poll(() => page.locator("#editor-canvas").getAttribute("aria-label"))
        .toBe("PDF 1 / 2");
      fail = true;
      running = true;
      await page.locator(".cm-content").fill("Edited\n\\badcommand");
      await expect
        .poll(() => text, { timeout: 5000 })
        .toBe("Edited\n\\badcommand");
      await expect.poll(() => posts, { timeout: 5000 }).toBe(2);
      await expect
        .poll(() => page.locator("#editor-preview-status").textContent())
        .toBe("コンパイル中");
      const activeJob = await page.locator("#editor-build-detail").getAttribute("href");
      expect(activeJob).toBe(`/app/jobs/${failedJobId}/`);
      await openOptions("settings");
      await page.locator("#editor-language").selectOption("en");
      await expect
        .poll(() => page.locator("#app-editor").getAttribute("lang"))
        .toBe("en");
      expect(await page.locator("#editor-build-detail").getAttribute("href")).toBe(activeJob);
      expect(await page.locator("#editor-canvas").getAttribute("aria-label")).toBe("PDF 1 / 2");
      expect(posts).toBe(2);
      await page.locator("#editor-language").selectOption("ja");
      await expect
        .poll(() => page.locator("#app-editor").getAttribute("lang"))
        .toBe("ja");
      await page.keyboard.press("Escape");
      running = false;
      await expect
        .poll(() => page.locator("#editor-preview-status").textContent(), {
          timeout: 5_000,
        })
        .toBe("コンパイル失敗");
      expect(await page.locator("#editor-canvas").isVisible()).toBe(true);
      expect(
        await page.locator("#editor-canvas").getAttribute("aria-label"),
      ).toBe("PDF 1 / 2");
      expect(await page.locator("#editor-pdf").getAttribute("href")).toBe(pdfPath);
      const retainedVersion = await page.locator("#editor-preview-version").textContent();
      expect(retainedVersion).toContain("下書き版 1");
      expect(retainedVersion).toContain("最新の編集は反映されていません");
      await page.setViewportSize({ width: 390, height: 780 });
      await page.getByRole("button", { name: "エラー", exact: true }).click();
      expect(await page.locator("#editor-error-detail").isVisible()).toBe(true);
      await page.getByRole("button", { name: "main.tex:2" }).click();
      expect(
        await page.locator("#editor-layout").getAttribute("data-panel"),
      ).toBe("source");
      expect(await page.locator(".cm-activeLine").textContent()).toBe(
        "\\badcommand",
      );
      await page.getByRole("button", { name: "PDF", exact: true }).click();
      const pngStart = performance.now();
      await openOptions("preview");
      await page.locator("#editor-preview-mode").selectOption("png");
      await page.keyboard.press("Escape");
      await expect
        .poll(() => page.locator("#editor-canvas").getAttribute("aria-label"))
        .toBe("PNG 1 / 2");
      const pngMs = Math.round(performance.now() - pngStart);
      // The canvas is painted before the previous PDF is torn down and timed.
      await page.waitForFunction(
        () =>
          performance.getEntriesByName(
            "latex-renderer:editor:png-load-and-paint",
            "measure",
          ).length > 0,
      );
      const browserTiming = await page.evaluate(() =>
        performance
          .getEntriesByType("measure")
          .filter(({ name }) => name.startsWith("latex-renderer:editor:"))
          .map(({ name, duration }) => ({ name, ms: Math.round(duration) })),
      );
      expect(browserTiming.map(({ name }) => name)).toEqual(
        expect.arrayContaining([
          "latex-renderer:editor:input-idle",
          "latex-renderer:editor:save-and-queue",
          "latex-renderer:editor:pdf-load-and-paint",
          "latex-renderer:editor:png-load-and-paint",
        ]),
      );
      if (process.env.EDITOR_PREVIEW_BENCHMARK === "1")
        console.log(
          JSON.stringify({
            event: "editor_preview_fixture",
            pdfMs,
            pngMs,
            pdfBytes,
            pngBytes: png.length,
            pdfFullBytes: pdf.length,
            rangeRequests: ranges.length,
            cssRequests,
            browserTiming,
          }),
        );
      expect(failures).toEqual([]);
      await page.setViewportSize({ width: 1100, height: 800 });
      const beforeReload = observed.length;
      await page.reload();
      await page.locator("#editor-canvas:visible").waitFor({ timeout: 9000 });
      expect(
        await page.locator("#editor-canvas").getAttribute("aria-label"),
      ).toBe("PNG 1 / 2");
      expect(
        observed
          .slice(beforeReload)
          .some((path) => path.startsWith(assetRoot + "pdf/")),
      ).toBe(false);
      expect(await page.locator("#editor-preview-status").textContent()).toBe(
        "コンパイル失敗",
      );
      await expect
        .poll(() => page.locator("#editor-preview-version").textContent())
        .toContain("下書き版 1");
      expect(posts).toBe(2);
      const savedRevision =
        origin + editorPath + "?revision=revision_" + "b".repeat(32);
      page.once("dialog", (dialog) => void dialog.dismiss());
      await page.goto(savedRevision);
      await page.locator(".cm-content").filter({ hasText: "Edited" })
        .waitFor({ timeout: 10_000 });
      expect(replacements).toBe(0);

      page.once("dialog", (dialog) => void dialog.accept());
      await page.goto(savedRevision);
      await page.locator("#editor-template").waitFor({ state: "visible" });
      expect(replacements).toBe(1);
      expect(await page.locator(".cm-content").textContent()).toBe("");
      await openOptions("settings");
      await page.locator("#editor-auto").uncheck();
      await page.keyboard.press("Escape");
      await page.locator("#editor-template").selectOption("report");
      await expect
        .poll(() => text, { timeout: 5000 })
        .toContain("\\documentclass{report}");
      await openOptions("settings");
      await page.locator("#editor-revision-outputs").selectOption("svg");
      page.once("dialog", (dialog) => void dialog.accept("Draft revision"));
      await page.locator("#editor-save-revision").click();
      await expect.poll(() => savedOutputs).toEqual(["pdf", "svg"]);
      const source = page.locator(".cm-content");
      await expect
        .poll(() => source.getAttribute("contenteditable"))
        .toBe("true");
      const savedSource = await source.textContent();
      await source.focus();
      await page.keyboard.insertText("Temporary document edit");
      await expect
        .poll(() => source.textContent())
        .toContain("Temporary document edit");
      const editedSource = await source.textContent();
      await openOptions("settings");
      await page.locator("#editor-language").selectOption("de");
      await expect
        .poll(() => page.locator("#app-editor").getAttribute("lang"))
        .toBe("de");
      expect(await page.locator("html").getAttribute("lang")).toBe("de");
      const theme = page.locator("[data-theme-toggle]");
      await theme.click();
      await expect.poll(() => theme.textContent()).toBe("Design: Hell");
      await theme.click();
      await expect.poll(() => theme.textContent()).toBe("Design: Dunkel");
      expect(observed).toContain(assetRoot + "locales/de.js");
      expect(await source.textContent()).toBe(editedSource);
      await page.keyboard.press("Escape");
      await source.focus();
      await page.keyboard.press(
        process.platform === "darwin" ? "Meta+z" : "Control+z",
      );
      expect(await source.textContent()).toBe(savedSource);
      await page.setViewportSize({ width: 320, height: 650 });
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      expect(posts).toBe(2);

      // A second editor saves the same file while this tab has a draft open.
      version++;
      text = "Server-side edit";
      await source.focus();
      await page.keyboard.insertText("Pending local edit");
      const review = page.locator("#editor-review-conflict");
      await review.waitFor({ state: "visible" });
      await review.click();
      await expect.poll(() => page.locator("#editor-conflict-server").textContent()).toContain("Server-side edit");
      await expect.poll(() => page.locator("#editor-conflict-local").textContent()).toContain("Pending local edit");
      await page.locator("#editor-conflict-apply").click();
      await review.waitFor({ state: "hidden" });
      expect(text).toContain("Pending local edit");

      // Keep unsaved source open while an old PDF module stops being served.
      retiredPdfAssets = true;
      await source.focus();
      await page.keyboard.insertText("Keep this tab");
      await page.getByRole("button", { name: "PDF", exact: true }).click();
      await openOptions("preview");
      await page.locator("#editor-preview-mode").selectOption("pdf");
      await page.keyboard.press("Escape");
      await page.locator("#editor-preview-notice").waitFor({ state: "visible" });
      await expect.poll(() => page.locator("#editor-canvas").getAttribute("aria-label")).toBe("PNG 1 / 2");
      expect(await source.textContent()).toContain("Keep this tab");

      // Autosave must keep working while the preview request is held open.
      const initialPosts = posts;
      let resumePreview: (() => void) | undefined;
      previewGate = new Promise<void>((resolve) => { resumePreview = resolve; });
      try {
        await openOptions("settings");
        await page.locator("#editor-auto").check();
        await page.keyboard.press("Escape");
        await expect.poll(() => posts, { timeout: 5_000 }).toBe(initialPosts + 1);
        await page.locator('button[data-panel="source"]').click();
        await source.focus();
        await page.keyboard.insertText("Save before the preview reply");
        await expect.poll(() => source.textContent())
          .toContain("Save before the preview reply");
        await expect.poll(() => text, { timeout: 5_000 })
          .toContain("Save before the preview reply");
        expect(posts).toBe(initialPosts + 1);
      } finally {
        previewGate = undefined;
        resumePreview?.();
      }
      await expect.poll(() => posts, { timeout: 5_000 }).toBe(initialPosts + 2);
    } catch (error) {
      throw new Error(
        `${String(error)}\n${JSON.stringify({
          observed,
          failures,
          failedRequests,
          text: await page
            .locator("main")
            .textContent()
            .catch(() => null),
        })}`,
        { cause: error },
      );
    } finally {
      await page.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 50_000);
});
