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
  type ServerSetupSessionHost,
} from "../../packages/server-setup-core/src/index.mjs";
import { ingressTlsFixture } from "../fixtures/server-ingress.js";

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
async function fixture(mobile = false, supplied?: ServerSetupSessionHost) {
  const apply = vi.fn(),
    preview = vi.fn((review: ServerSetupReview) => ({ review }));
  const web = await startServerSetupWeb(
    supplied ?? { current: model, preview, apply },
  );
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
  it("completes initial Web input without secrets in preview, storage or a terminal handoff", async () => {
    const tls = ingressTlsFixture();
    try {
      const review = importServerSetupReview(
        [
          "DEPLOYMENT_MODE=standalone",
          "AUTH_MODE=password",
          "PUBLIC_ORIGIN=https://localhost",
          "RENDERER_PUBLIC_URL=https://localhost",
          "INGRESS_ACCESS_SCOPE=local",
          "INGRESS_TLS_PROVIDER=custom",
          "INGRESS_LISTEN_ADDRESS=127.0.0.1",
          "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3",
          "STORAGE_ROOT=/var/lib/latex-renderer/storage",
          `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
          "",
        ].join("\n"),
      );
      let appliedLogin: string | undefined;
      const apply = vi.fn<ServerSetupSessionHost["apply"]>(
        (_envelope, credentials) => {
          if (credentials && "owner" in credentials)
            appliedLogin = credentials.owner.loginName;
        },
      );
      const f = await fixture(true, {
        scope: "initial-prepared-host",
        current: () => review,
        preview: (candidate) => ({ candidate }),
        apply,
      });
      await f.page.locator("#owner-name").fill("Owner");
      await f.page.locator("#deployment-user").fill("ubuntu");
      await f.page.locator("#owner-login").fill("owner");
      await f.page
        .locator("#owner-password")
        .fill("long-private-fixture-passphrase");
      await f.page
        .locator("#owner-confirm")
        .fill("long-private-fixture-passphrase");
      await f.page.locator("#tls-certificate").fill(tls.certificate.toString());
      await f.page.locator("#tls-key").fill(tls.key.toString());
      await f.page
        .getByRole("button", { name: "変更内容を確認", exact: true })
        .click();
      await f.page.locator("#summary").waitFor({ state: "visible" });
      expect(await f.page.locator("#summary").textContent()).not.toMatch(
        /private-fixture|PRIVATE KEY/,
      );
      expect(
        await f.page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await f.page
        .getByRole("button", { name: "この内容で適用する", exact: true })
        .click();
      await f.page.waitForFunction(() =>
        document.getElementById("status")?.textContent.startsWith("適用完了"),
      );
      await f.web.closed;
      expect(appliedLogin).toBe("owner");
      expect(apply).toHaveBeenCalledOnce();
      expect(await f.page.locator("#owner-password").inputValue()).toBe("");
      expect(await f.page.locator("#tls-key").inputValue()).toBe("");
      expect(
        await f.page.evaluate(
          () => localStorage.length + sessionStorage.length,
        ),
      ).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      tls.cleanup();
    }
  });
  it("recovers a failed host apply within the same Web session", async () => {
    const recover = vi.fn(() => ({ committed: true }));
    const f = await fixture(false, {
      current: model,
      preview: (review) => ({ review }),
      apply: () => {
        throw new Error("private-host-detail");
      },
      recover,
    });
    await f.page
      .getByRole("button", { name: "変更内容を確認", exact: true })
      .click();
    await f.page.locator("#summary").waitFor({ state: "visible" });
    await f.page
      .getByRole("button", { name: "この内容で適用する", exact: true })
      .click();
    await f.page
      .getByRole("button", { name: "中断した設定を復旧する", exact: true })
      .waitFor({ state: "visible" });
    expect(await f.page.locator("#status").textContent()).not.toContain(
      "private-host-detail",
    );
    await f.page
      .getByRole("button", { name: "中断した設定を復旧する", exact: true })
      .click();
    await f.page.waitForFunction(() =>
      document.getElementById("status")?.textContent.startsWith("復旧完了"),
    );
    await f.web.closed;
    expect(recover).toHaveBeenCalledOnce();
    expect(f.errors).toEqual([]);
  });
});
