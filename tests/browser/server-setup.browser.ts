import { chromium, type Browser, type Page } from "playwright";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { startServerSetupWeb } from "../../deploy/scripts/server-setup-web.mjs";
import {
  importServerSetupReview,
  type ServerSetupReview,
} from "../../packages/server-setup-core/src/index.mjs";

let browser: Browser;
const fixtures: {
  page: Page;
  web: Awaited<ReturnType<typeof startServerSetupWeb>>;
}[] = [];
beforeAll(async () => {
  browser = await chromium.launch();
});
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.page.close();
    f.web.close();
    await f.web.closed;
  }
});
afterAll(async () => {
  await browser.close();
});
const model = () =>
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
async function fixture(mobile = false) {
  const apply = vi.fn(),
    preview = vi.fn((review: ServerSetupReview) => ({ review }));
  const web = await startServerSetupWeb({ current: model, preview, apply });
  const page = await browser.newPage({
    viewport: mobile
      ? { width: 390, height: 844 }
      : { width: 1200, height: 800 },
  });
  fixtures.push({ page, web });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(web.bootstrapUrl);
  await page.waitForFunction(() =>
    document.getElementById("status")?.textContent.includes("変更を入力"),
  );
  return { apply, preview, web, page, errors };
}

describe("real server-settings Web flow", () => {
  it("exchanges/removes the fragment and works without storage or terminal switching", async () => {
    const f = await fixture();
    expect(f.page.url()).toBe(`${f.web.origin}/`);
    expect(
      await f.page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ local: 0, session: 0 });
    expect(await f.page.locator("#limits input").count()).toBe(16);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  });
  it("edits, reviews and applies the exact candidate, then shuts down the bootstrap", async () => {
    const f = await fixture();
    await f.page
      .getByRole("spinbutton", { name: "maxQueueLength", exact: true })
      .fill("42");
    await f.page
      .getByRole("button", { name: "変更内容を確認", exact: true })
      .click();
    await f.page.waitForFunction(
      () => !document.getElementById("confirmation")?.hidden,
    );
    expect(f.preview.mock.calls[0]?.[0].runtime.limits.maxQueueLength).toBe(42);
    expect(f.apply).not.toHaveBeenCalled();
    await f.page
      .getByRole("button", { name: "この内容で適用する", exact: true })
      .click();
    await f.page.waitForFunction(() =>
      document.getElementById("status")?.textContent.startsWith("適用完了"),
    );
    await f.web.closed;
    expect(f.apply).toHaveBeenCalledTimes(1);
    expect(f.errors).toEqual([]);
  });
  it("invalidates confirmation when the user edits after preview", async () => {
    const f = await fixture();
    await f.page
      .getByRole("button", { name: "変更内容を確認", exact: true })
      .click();
    await f.page.waitForFunction(
      () => !document.getElementById("confirmation")?.hidden,
    );
    await f.page
      .getByRole("spinbutton", { name: "maxQueueLength", exact: true })
      .fill("43");
    expect(await f.page.locator("#confirmation").isVisible()).toBe(false);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  });
  it("keeps all controls inside a narrow mobile viewport", async () => {
    const f = await fixture(true);
    const dimensions = await f.page.evaluate(() => ({
      width: innerWidth,
      body: document.documentElement.scrollWidth,
    }));
    expect(dimensions.body).toBeLessThanOrEqual(dimensions.width);
    const button = await f.page
      .getByRole("button", { name: "変更内容を確認", exact: true })
      .boundingBox();
    expect(button?.height).toBeGreaterThanOrEqual(44);
    expect(f.errors).toEqual([]);
  });
});
