import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import yazl from "yazl";
import { zipSingleTex } from "../../apps/admin-web/src/assets/render-script.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";
import { appRenderPage } from "../../apps/admin-web/src/templates-app.js";

// Real Chromium, real File/crypto/fetch/DOM, shipped HTML/CSS/script. The API
// boundary is simulated; this does not claim to run TeX or production auth.
const origin = "http://127.0.0.1:43127";
const expiresAt = "2099-01-01T00:00:00.000Z";
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
beforeAll(async () => {
  browser = await chromium.launch();
});
afterEach(async () => {
  await Promise.all(pages.splice(0).map((page) => page.close()));
});
afterAll(async () => {
  await browser?.close();
});

async function fixture() {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage();
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
    rejectCapacity: 0,
    capacityAlways: false,
    ticketError: "",
    sourceError: false,
    statusError: false,
    sourceGate: Promise.resolve(),
  };
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
      state.uploads.push(request.postDataBuffer() ?? Buffer.alloc(0));
      await route.fulfill({ status: 204 });
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
        status: state.complete ? "succeeded" : "running",
        errorCode: null,
        errorMessage: null,
        retentionExpiresAt: null,
        artifacts: [],
        previews: [],
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

describe("App render in Chromium", () => {
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

  it.each([375, 768])(
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
