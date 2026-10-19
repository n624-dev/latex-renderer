import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { Browser, Page } from "playwright";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { readFixtureBody } from "../helpers/fixture-http.js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import yazl from "yazl";
import { zipSingleTex } from "../../apps/admin-web/src/assets/render-script.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";
import { appRenderPage } from "../../apps/admin-web/src/templates-app.js";

// Real browser, real File/crypto/fetch/DOM, shipped HTML/CSS/script. The API
// boundary is simulated; this does not claim to run TeX or production auth.
const expiresAt = "2099-01-01T00:00:00.000Z";
const previewPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1cAAAAASUVORK5CYII=",
  "base64",
);
const previewSha = createHash("sha256").update(previewPng).digest("hex");
// Serialize the actual tsc-built module in native Node. Vitest's SSR import
// rewriting changes function.toString(), which is how App emits its script.
const appScript = execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    "const module = await import(process.argv[1]); process.stdout.write(module.appScript);",
    new URL("../../apps/admin-web/dist/assets/app-script.js", import.meta.url)
      .href,
  ],
  { encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
);
let browser: Browser | undefined;
const pages: Page[] = [];
const uploadServers: Server[] = [];
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterEach(async () => {
  await Promise.all(pages.splice(0).map((page) => page.close()));
  await Promise.all(
    uploadServers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    ),
  );
});
afterAll(async () => {
  await browser?.close();
});

async function fixture() {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser);
  pages.push(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const state = {
    sources: [] as Array<{ size: number; sha256: string }>,
    uploads: [] as Buffer[],
    projects: [] as unknown[],
    requests: [] as Array<{
      body: Record<string, unknown>;
      key: string | undefined;
    }>,
    active: new Set<string>(),
    maxActive: 0,
    polls: 0,
    complete: true,
    staged: false,
    svgFailed: false,
    svgRetries: [] as string[],
    resourceWait: false,
    rejectCapacity: 0,
    capacityAlways: false,
    ticketError: "",
    sourceError: false,
    statusError: false,
    sourceGate: Promise.resolve(),
    lazyPages: 0,
    previewReady: false,
    previewPending: 0,
    previewCalls: [] as number[],
    previewDigestMismatch: false,
  };
  // WebKit's interception protocol does not expose Blob request bytes through
  // postDataBuffer(). Receive real network bytes instead, in both engines;
  // never replace a missing body with an empty successful synthetic upload.
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (
          request.method !== "PUT" ||
          !/^\/api\/v1\/sources\/source_[a-f0-9]{32}\/content$/.test(
            request.url ?? "",
          )
        ) {
          response.writeHead(404).end();
          return;
        }
        expect(request.headers.authorization).toBe(
          "Bearer test-upload-ticket-1234567890",
        );
        state.uploads.push(await readFixtureBody(request));
        response.writeHead(204).end();
      } catch {
        errors.push("Fixture upload failed");
        response.writeHead(500).end();
      }
    })();
  });
  uploadServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing upload listener");
  const origin = `http://127.0.0.1:${address.port}`;
  await page.addInitScript(() => {
    // Delayed reads reproduce selection races without relying on file size.
    const reads = new Map<
      string,
      { resolve: (bytes: ArrayBuffer) => void; reject: () => void }
    >();
    Object.assign(window, { delayedReads: reads });
    const original = (file: File) => Blob.prototype.arrayBuffer.call(file);
    File.prototype.arrayBuffer = function () {
      if (!this.name.startsWith("slow")) return original(this);
      return new Promise<ArrayBuffer>((resolve, reject) => {
        reads.set(this.name, {
          resolve,
          reject: () => reject(new Error("stale read failure")),
        });
      });
    };
  });
  await page.route("**/*", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body });
    if (request.url().split("/").slice(0, 3).join("/") !== origin) {
      errors.push("unexpected external request");
      await route.abort();
      return;
    }
    if (path === "/app/") {
      await route.fulfill({ contentType: "text/html", body: appRenderPage() });
      return;
    }
    if (path === "/app/assets/app.js") {
      await route.fulfill({ contentType: "text/javascript", body: appScript });
      return;
    }
    if (path === "/app/assets/styles.css") {
      await route.fulfill({ contentType: "text/css", body: styles });
      return;
    }
    if (path === "/app/assets/site.js") {
      await route.fulfill({ contentType: "text/javascript", body: "" });
      return;
    }
    if (path === "/auth/session") {
      await json({ csrfToken: "test-csrf" });
      return;
    }
    if (path === "/app/api/v1/me") {
      await json({ isAdmin: false });
      return;
    }
    if (request.method() === "POST")
      expect(request.headers()["x-csrf-token"]).toBe("test-csrf");
    if (path === "/app/api/v1/projects") {
      if (request.method() === "POST") {
        state.projects.push(request.postDataJSON());
        await json({ id: "project_new" });
      } else
        await json({
          items: [
            { id: "project_one", displayName: "One" },
            { id: "project_two", displayName: "Two" },
          ],
          hasMore: false,
          nextCursor: null,
        });
      return;
    }
    if (path === "/app/api/v1/jobs") {
      await json({ items: [], hasMore: false });
      return;
    }
    if (path === "/app/api/v1/source-tickets") {
      state.sources.push(
        request.postDataJSON() as { size: number; sha256: string },
      );
      const id = `source_${state.sources.length.toString(16).padStart(32, "0")}`;
      await state.sourceGate;
      if (state.sourceError) {
        await json({ error: { code: "SOURCE_NOT_READY" } }, 409);
        return;
      }
      await json({
        sourceId: id,
        uploadRequired: true,
        expiresAt,
        uploadTicket: "test-upload-ticket-1234567890",
        uploadUrl: `${origin}/api/v1/sources/${id}/content`,
      });
      return;
    }
    if (/^\/api\/v1\/sources\/source_[a-f0-9]{32}\/content$/.test(path)) {
      expect(request.headers().authorization).toBe(
        "Bearer test-upload-ticket-1234567890",
      );
      await route.continue();
      return;
    }
    if (path === "/app/api/v1/render-tickets") {
      state.requests.push({
        body: request.postDataJSON() as Record<string, unknown>,
        key: request.headers()["idempotency-key"],
      });
      if (state.ticketError) {
        await json({ error: { code: state.ticketError } }, 503);
        return;
      }
      if (
        state.capacityAlways ||
        state.rejectCapacity-- > 0 ||
        state.active.size >= 5
      ) {
        await json({ error: { code: "ACCOUNT_QUEUE_LIMIT" } }, 429);
        return;
      }
      const id = `job_${state.requests.length.toString(16).padStart(32, "0")}`;
      state.active.add(id);
      state.maxActive = Math.max(state.maxActive, state.active.size);
      await json({
        jobId: id,
        jobTicket: "test-job-ticket-1234567890",
        expiresAt,
      });
      return;
    }
    if (/^\/app\/api\/v1\/jobs\/job_[a-f0-9]{32}\/access-ticket$/.test(path)) {
      await json({
        jobId: path.split("/").at(-2),
        jobTicket: "test-job-ticket-1234567890",
        expiresAt,
      });
      return;
    }
    if (
      /^\/api\/v1\/jobs\/job_[a-f0-9]{32}\/previews\/page-[1-9][0-9]*\.png$/.test(
        path,
      )
    ) {
      const selected = Number(/page-(\d+)\.png$/.exec(path)?.[1]);
      state.previewCalls.push(selected);
      expect(request.headers().authorization).toBe(
        "Bearer test-job-ticket-1234567890",
      );
      if (state.previewPending-- > 0) {
        await route.fulfill({
          status: 503,
          json: { error: { code: "PREVIEW_PENDING" } },
          headers: { "Retry-After": "2" },
        });
      } else {
        state.previewReady = true;
        await route.fulfill({ contentType: "image/png", body: previewPng });
      }
      return;
    }
    if (/^\/app\/api\/v1\/jobs\/job_[a-f0-9]{32}\/retry-svg$/.test(path)) {
      expect(request.method()).toBe("POST");
      const key = request.headers()["idempotency-key"];
      expect(key).toMatch(/^[a-f0-9-]{36}$/);
      state.svgRetries.push(key ?? "");
      state.svgFailed = false;
      state.complete = true;
      await json(
        {
          jobId: path.split("/").at(-2),
          jobTicket: "test-job-ticket-1234567890",
          expiresAt,
        },
        202,
      );
      return;
    }
    if (/^\/api\/v1\/jobs\/job_[a-f0-9]{32}$/.test(path)) {
      state.polls++;
      if (state.statusError) {
        await route.fulfill({ status: 503 });
        return;
      }
      const id = path.split("/").at(-1) ?? "";
      if (state.complete) state.active.delete(id);
      await json({
        id,
        status: state.svgFailed
          ? "failed"
          : state.resourceWait
            ? "queued"
            : state.complete
              ? "succeeded"
              : "running",
        errorCode: state.resourceWait ? "HOST_RESOURCE_WAIT" : null,
        errorMessage: state.resourceWait ? "Waiting for host resources" : null,
        retentionExpiresAt: state.staged ? expiresAt : null,
        artifacts: state.staged
          ? [
              {
                type: "pdf",
                relativePath: "result.pdf",
                size: 100,
                sha256: "a".repeat(64),
                createdAt: "2026-01-01T00:00:00.000Z",
                downloadUrl: `/api/v1/jobs/${id}/artifacts/result.pdf`,
              },
              ...(state.svgFailed
                ? [
                    {
                      type: "log",
                      relativePath: "svg/compile.log",
                      size: 10,
                      sha256: "b".repeat(64),
                      createdAt: "2026-01-01T00:00:00.000Z",
                      downloadUrl: `/api/v1/jobs/${id}/artifacts/svg/compile.log`,
                    },
                  ]
                : []),
            ]
          : [],
        ...(state.lazyPages > 0 ? { previewPageCount: state.lazyPages } : {}),
        previews:
          state.lazyPages > 0
            ? [1, ...(state.previewReady ? [3] : [])].map((number) => ({
                type: "preview",
                relativePath: `previews/page-${number}.png`,
                size: previewPng.length,
                sha256:
                  state.previewDigestMismatch && number === 3
                    ? "0".repeat(64)
                    : previewSha,
                createdAt: "2026-01-01T00:00:00.000Z",
                downloadUrl: `/api/v1/jobs/${id}/previews/page-${number}.png`,
              }))
            : [],
        ...(state.staged
          ? {
              stages: {
                pdf: {
                  status: "succeeded",
                  sha256: "a".repeat(64),
                  completedAt: "2026-01-01T00:00:00.000Z",
                  errorCode: null,
                  errorMessage: null,
                },
                svg: {
                  status: state.svgFailed
                    ? "failed"
                    : state.complete
                      ? "succeeded"
                      : "running",
                  attempt: state.svgRetries.length + 1,
                  completedAt: state.complete
                    ? "2026-01-01T00:00:00.000Z"
                    : null,
                  errorCode: state.svgFailed ? "SVG_GENERATION_FAILED" : null,
                  errorMessage: null,
                },
              },
            }
          : {}),
      });
      return;
    }
    errors.push(`unexpected route ${path}`);
    await route.fulfill({ status: 404 });
  });
  await page.goto(`${origin}/app/`);
  await page
    .waitForFunction(
      () =>
        document.querySelector<HTMLSelectElement>("#app-project-select")
          ?.options.length === 3,
      undefined,
      { timeout: 5_000 },
    )
    .catch(() => {
      throw new Error(`App failed to initialize: ${JSON.stringify(errors)}`);
    });
  return { page, state, errors };
}

const tex = (name: string, text = name) => ({
  name,
  mimeType: "text/plain",
  buffer: Buffer.from(text),
});
const start = (page: Page) => page.locator("#app-render-start");
async function ready(page: Page) {
  await expect
    .poll(() => start(page).isEnabled(), { timeout: 5_000 })
    .toBe(true)
    .catch(async (error: unknown) => {
      throw new Error(
        `Render button did not become ready: ${await page.locator("#app-error").textContent()}`,
        { cause: error },
      );
    });
}
async function finish(page: Page) {
  await ready(page);
  expect(await page.locator("#app-error").textContent()).toBe("");
}
async function fastTimers(page: Page) {
  await page.evaluate(() => {
    const original = window.setTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      delay?: number,
      ...args: unknown[]
    ) =>
      original(
        handler,
        Math.min(delay ?? 0, 10),
        ...args,
      )) as typeof window.setTimeout;
  });
}
async function releaseRead(page: Page, name: string, fail = false) {
  await page.evaluate(
    ({ name, fail }) => {
      const read = (
        window as unknown as {
          delayedReads: Map<
            string,
            { resolve: (bytes: ArrayBuffer) => void; reject: () => void }
          >;
        }
      ).delayedReads.get(name);
      if (!read) throw new Error("missing delayed read");
      if (fail) read.reject();
      else read.resolve(new TextEncoder().encode("STALE").buffer);
    },
    { name, fail },
  );
}

describe("App render in the selected browser", () => {
  it.each([false, true])(
    "requests only the selected missing PNG, retries pending generation and verifies SHA before opening: mismatch=%s",
    async (mismatch) => {
      const { page, state, errors } = await fixture();
      await fastTimers(page);
      state.lazyPages = 3;
      state.previewPending = 1;
      state.previewDigestMismatch = mismatch;
      await page.locator("#app-files").setInputFiles(tex("lazy.tex"));
      await ready(page);
      await start(page).click();
      await finish(page);
      const select = page.getByLabel("プレビューのページ");
      await expect.poll(() => select.count()).toBe(1);
      expect(state.previewCalls).toEqual([]);
      await select.selectOption("3");
      const opened = page.waitForEvent("popup");
      await page
        .getByRole("button", { name: "プレビュー", exact: true })
        .click();
      const popup = await opened;
      pages.push(popup);
      await expect.poll(() => state.previewCalls.length).toBe(2);
      expect(state.previewCalls).toEqual([3, 3]);
      if (mismatch) {
        await expect
          .poll(() => page.locator("#app-error").textContent())
          .toContain("SHA-256");
        await expect.poll(() => popup.isClosed()).toBe(true);
      } else {
        await expect.poll(() => popup.url()).toMatch(/^blob:/);
        expect(await page.locator("#app-error").textContent()).toBe("");
      }
      expect(state.requests).toHaveLength(1);
      expect(errors).toEqual([]);
    },
  );
  it("keeps PDF available while SVG runs, then retries only SVG on the same Job", async () => {
    const { page, state, errors } = await fixture();
    await fastTimers(page);
    state.staged = true;
    state.complete = false;
    expect(await page.locator("#app-render-svg").isVisible()).toBe(false);
    await page.locator("#app-render-options > summary").click();
    await page.locator("#app-files").setInputFiles(tex("staged.tex"));
    await ready(page);
    await page.locator("#app-render-svg").check();
    await start(page).click();
    await expect
      .poll(() =>
        page.getByRole("button", { name: "PDF", exact: true }).count(),
      )
      .toBe(1);
    await expect
      .poll(() => page.locator("body").textContent())
      .toContain("SVG: 変換中");
    state.svgFailed = true;
    state.complete = true;
    await expect
      .poll(() => page.locator("body").textContent())
      .toContain("部分成功");
    const retry = page.getByRole("button", {
      name: "SVGだけ再試行",
      exact: true,
    });
    await expect.poll(() => retry.count()).toBe(1);
    await retry.click();
    await expect.poll(() => state.svgRetries.length).toBe(1);
    await expect
      .poll(() => page.locator("body").textContent())
      .toContain("SVG: 変換成功");
    expect(state.requests).toHaveLength(1);
    expect(state.sources).toHaveLength(1);
    expect(state.uploads).toHaveLength(1);
    expect(errors).toEqual([]);
  });
  it("preserves file selection through reflow zoom and rotation, with touch submission when enabled", async () => {
    const { page, state, errors } = await fixture();
    const name = `${"日本語の長いファイル名".repeat(8)}.tex`;
    await page.setViewportSize({ width: 780, height: 900 });
    await page.locator("#app-files").setInputFiles(tex(name));
    await ready(page);
    // CSS layout zoom tests reflow; this is not physical Safari/pinch acceptance.
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
    await page.setViewportSize({ width: 844, height: 390 });
    await start(page).scrollIntoViewIfNeeded();
    const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
    if (touch) await start(page).tap();
    else await start(page).click();
    await finish(page);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]?.body.originalFilename).toBe(name);
    expect(errors).toEqual([]);
  });

  it.each([false, true])(
    "ignores stale read completion (failure=%s) and submits the visible file",
    async (fail) => {
      const { page, state, errors } = await fixture();
      await page.locator("#app-files").setInputFiles(tex("slow.tex"));
      await page
        .locator("#app-files")
        .setInputFiles(tex("visible.tex", "VISIBLE"));
      await ready(page);
      await releaseRead(page, "slow.tex", fail);
      await start(page).click();
      await finish(page);
      expect(state.requests).toHaveLength(1);
      expect(state.requests[0]?.body.originalFilename).toBe("visible.tex");
      const bytes = Buffer.from(zipSingleTex(Buffer.from("VISIBLE")));
      expect(state.uploads).toEqual([bytes]);
      expect(state.sources[0]?.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(errors).toEqual([]);
    },
  );

  it("immediately invalidates a previous selection and stays empty after a delayed read", async () => {
    const { page, state, errors } = await fixture();
    await page.locator("#app-files").setInputFiles(tex("old.tex"));
    await ready(page);
    await page.locator("#app-files").setInputFiles(tex("slow.tex"));
    expect(await start(page).isDisabled()).toBe(true);
    await page.locator("#app-render-form").dispatchEvent("submit");
    await page.locator("#app-files").setInputFiles([]);
    await releaseRead(page, "slow.tex");
    await page.locator("#app-render-form").dispatchEvent("submit");
    expect(await start(page).isDisabled()).toBe(true);
    expect(await page.locator("#app-entrypoints").textContent()).toBe("");
    expect(state.sources).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("snapshots Project/output options, rejects duplicate submit, and preserves a new selection", async () => {
    const { page, state, errors } = await fixture();
    await page.locator("#app-render-options > summary").click();
    let release!: () => void;
    state.sourceGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.locator("#app-files").setInputFiles(tex("first.tex"));
    await ready(page);
    await page.locator("#app-project-select").selectOption("project_one");
    await page.locator("#app-render-svg").check();
    await start(page).click();
    await expect.poll(() => state.sources.length).toBe(1);
    await page.locator("#app-project-select").selectOption("project_two");
    await page.locator("#app-render-svg").uncheck();
    await page.locator("#app-files").setInputFiles(tex("next.tex"));
    expect(await start(page).isDisabled()).toBe(true);
    await page.locator("#app-render-form").dispatchEvent("submit");
    release();
    await finish(page);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]?.body).toMatchObject({
      projectId: "project_one",
      outputs: ["pdf", "svg"],
      originalFilename: "first.tex",
    });
    await start(page).click();
    await finish(page);
    expect(state.requests[1]?.body).toMatchObject({
      projectId: "project_two",
      outputs: ["pdf"],
      originalFilename: "next.tex",
    });
    expect(state.projects).toHaveLength(0);
    expect(errors).toEqual([]);
  });

  it("keeps a cleared selection disabled after the submitted batch finishes", async () => {
    const { page, state, errors } = await fixture();
    await page.locator("#app-render-options > summary").click();
    let release!: () => void;
    state.sourceGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.locator("#app-files").setInputFiles(tex("submitted.tex"));
    await ready(page);
    await page.locator("#app-project-name").fill("Submitted name");
    await start(page).click();
    await expect.poll(() => state.sources.length).toBe(1);
    await page.locator("#app-project-name").fill("Changed name");
    await page.locator("#app-files").setInputFiles([]);
    release();
    await page.waitForFunction(() =>
      document
        .querySelector("#app-render-items")
        ?.textContent.includes("変換成功"),
    );
    await page.locator("#app-render-form").dispatchEvent("submit");
    expect(await start(page).isDisabled()).toBe(true);
    expect(state.requests).toHaveLength(1);
    expect(state.projects).toEqual([{ displayName: "Submitted name" }]);
    expect(errors).toEqual([]);
  });

  it("explains resource admission waits without treating a queued job as failed", async () => {
    const { page, state, errors } = await fixture();
    state.complete = false;
    state.resourceWait = true;
    await fastTimers(page);
    await page.locator("#app-files").setInputFiles(tex("waiting.tex"));
    await ready(page);
    await start(page).click();
    await expect
      .poll(async () =>
        (await page.locator("#app-render-items").textContent())?.includes(
          "サーバー資源の空きを待っています",
        ),
      )
      .toBe(true);
    expect(state.requests).toHaveLength(1);
    state.resourceWait = false;
    state.complete = true;
    await finish(page);
    expect(await page.locator("#app-render-items").textContent()).not.toContain(
      "サーバー資源の空きを待っています",
    );
    expect(errors).toEqual([]);
  });

  it("holds at most three Jobs until terminal status, then completes eight documents", async () => {
    const { page, state, errors } = await fixture();
    state.complete = false;
    await fastTimers(page);
    await page
      .locator("#app-files")
      .setInputFiles(Array.from({ length: 8 }, (_, i) => tex(`${i}.tex`)));
    await ready(page);
    await start(page).click();
    await expect.poll(() => state.polls).toBeGreaterThanOrEqual(6);
    expect(state.requests).toHaveLength(3);
    expect(state.maxActive).toBe(3);
    state.complete = true;
    await finish(page);
    expect(state.requests).toHaveLength(8);
    expect(state.maxActive).toBeLessThanOrEqual(3);
    expect(await page.locator("#app-render-items").textContent()).not.toContain(
      "開始できません",
    );
    expect(errors).toEqual([]);
  });

  it("uploads a multi-entrypoint ZIP once and shares its immutable Source", async () => {
    const { page, state, errors } = await fixture();
    const bytes = await zip([
      "first.tex",
      "second.tex",
      "third.tex",
      "fourth.tex",
    ]);
    await page.locator("#app-files").setInputFiles({
      name: "project.zip",
      mimeType: "application/zip",
      buffer: bytes,
    });
    await page.waitForFunction(
      () => document.querySelectorAll("#app-entrypoints input").length === 4,
    );
    for (const checkbox of await page.locator("#app-entrypoints input").all())
      await checkbox.check();
    await start(page).click();
    await finish(page);
    expect(state.sources).toHaveLength(1);
    expect(state.uploads).toEqual([bytes]);
    expect(state.requests.map((r) => r.body.entrypoint).sort()).toEqual([
      "first.tex",
      "fourth.tex",
      "second.tex",
      "third.tex",
    ]);
    expect(new Set(state.requests.map((r) => r.body.sourceId)).size).toBe(1);
    expect(new Set(state.requests.map((r) => r.key)).size).toBe(4);
    expect(errors).toEqual([]);
  });

  it("shares a failed Source promise instead of reserving it repeatedly", async () => {
    const { page, state, errors } = await fixture();
    state.sourceError = true;
    await page.locator("#app-files").setInputFiles({
      name: "project.zip",
      mimeType: "application/zip",
      buffer: await zip(["one.tex", "two.tex", "three.tex", "four.tex"]),
    });
    await page.waitForFunction(
      () => document.querySelectorAll("#app-entrypoints input").length === 4,
    );
    for (const checkbox of await page.locator("#app-entrypoints input").all())
      await checkbox.check();
    await start(page).click();
    await ready(page);
    expect(state.sources).toHaveLength(1);
    expect(state.requests).toHaveLength(0);
    expect(await page.locator("#app-error").textContent()).toContain(
      "SOURCE_NOT_READY",
    );
    expect(errors).toEqual([]);
  });

  it("retries capacity only, with identical body/key and no repeated Project creation", async () => {
    const { page, state, errors } = await fixture();
    state.rejectCapacity = 1;
    await fastTimers(page);
    await page.locator("#app-files").setInputFiles(tex("one.tex"));
    await ready(page);
    await start(page).click();
    await finish(page);
    expect(state.requests).toHaveLength(2);
    expect(state.requests[0]).toEqual(state.requests[1]);
    expect(state.projects).toHaveLength(1);
    expect(state.sources).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it.each(["capacity", "permanent"])(
    "stops bounded %s failures without an infinite loop",
    async (failure) => {
      const { page, state, errors } = await fixture();
      state.capacityAlways = failure === "capacity";
      state.ticketError = failure === "permanent" ? "MAINTENANCE" : "";
      await fastTimers(page);
      await page.locator("#app-files").setInputFiles(tex("one.tex"));
      await ready(page);
      await start(page).click();
      await ready(page);
      expect(state.requests).toHaveLength(failure === "capacity" ? 6 : 1);
      expect(new Set(state.requests.map((r) => r.key)).size).toBe(1);
      expect(state.projects).toHaveLength(1);
      expect(errors).toEqual([]);
    },
  );

  it("does not admit more queued Jobs after status tracking is exhausted", async () => {
    const { page, state, errors } = await fixture();
    state.statusError = true;
    await fastTimers(page);
    await page
      .locator("#app-files")
      .setInputFiles(Array.from({ length: 7 }, (_, i) => tex(`${i}.tex`)));
    await ready(page);
    await start(page).click();
    await ready(page);
    expect(state.requests).toHaveLength(3);
    expect(state.active.size).toBe(3);
    expect(await page.locator("#app-render-items").textContent()).toContain(
      "開始していません",
    );
    expect(errors).toEqual([]);
  });

  it.each([320, 375, 768, 1024, 1440])(
    "keeps render controls within a %ipx viewport",
    async (width) => {
      const { page, errors } = await fixture();
      await page.setViewportSize({ width, height: 900 });
      await page.locator("#app-files").setInputFiles(tex("document.tex"));
      await ready(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      const bounds = await start(page).boundingBox();
      expect(bounds).not.toBeNull();
      expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(
        width,
      );
      await start(page).click();
      await finish(page);
      expect(errors).toEqual([]);
    },
  );
});

async function zip(names: string[]): Promise<Buffer> {
  const archive = new yazl.ZipFile(),
    chunks: Buffer[] = [];
  for (const name of names) archive.addBuffer(Buffer.from(name), name);
  const result = new Promise<Buffer>((resolve, reject) => {
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
    archive.outputStream.on("error", reject);
  });
  archive.end();
  return result;
}
