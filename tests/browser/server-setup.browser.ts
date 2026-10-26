import type { Browser, Page } from "playwright";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
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
  browser = await launchTestBrowser();
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
  const page = await newTestPage(browser, {
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
  it("reviews MiB memory values as distinct admission, RAM and additional swap limits", async () => {
    const f = await fixture();
    await f.page
      .getByRole("spinbutton", {
        name: "minimumAvailableMemoryBytes",
        exact: true,
      })
      .fill("500");
    await f.page
      .getByRole("spinbutton", { name: "maximumMemoryBytes", exact: true })
      .fill("2048");
    await f.page
      .getByRole("spinbutton", { name: "maximumSwapBytes", exact: true })
      .fill("1024");
    await f.page
      .getByRole("button", { name: "変更内容を確認", exact: true })
      .click();
    await f.page.locator("#confirmation").waitFor({ state: "visible" });
    expect(f.preview.mock.calls[0]?.[0].runtime.limits).toMatchObject({
      minimumAvailableMemoryBytes: 500 * 1024 ** 2,
      maximumMemoryBytes: 2 * 1024 ** 3,
      maximumSwapBytes: 1024 ** 3,
    });
    expect(await f.page.locator("#summary").textContent()).toContain(
      "2048 MiB",
    );
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  });
  it.each(["oidc", "cloudflare-access"] as const)(
    "shows only applicable initial credentials for %s",
    async (auth) => {
      const cloudflare = auth === "cloudflare-access";
      const review = importServerSetupReview(
        [
          `DEPLOYMENT_MODE=${cloudflare ? "cloudflare" : "standalone"}`,
          `AUTH_MODE=${auth}`,
          "PUBLIC_ORIGIN=https://renderer.example.test",
          "RENDERER_PUBLIC_URL=https://renderer.example.test",
          "OIDC_ISSUER=https://identity.example.test/tenant",
          "OIDC_CLIENT_ID=fixture-renderer",
          "CLOUDFLARE_ACCESS_ISSUER=https://fixture.cloudflareaccess.com",
          `CLOUDFLARE_ADMIN_AUDIENCE=${"a".repeat(64)}`,
          `CLOUDFLARE_REMOTE_MCP_AUDIENCE=${"b".repeat(64)}`,
          "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3",
          "STORAGE_ROOT=/var/lib/latex-renderer/storage",
          `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
          "",
        ].join("\n"),
      );
      const f = await fixture(false, {
        scope: "initial-prepared-host",
        current: () => review,
        preview: (candidate) => ({ candidate }),
        apply: () => {},
      });
      expect(await f.page.locator("#owner-subject").isVisible()).toBe(true);
      expect(await f.page.locator("#owner-password").isVisible()).toBe(false);
      expect(await f.page.locator("#oidc-secret").isVisible()).toBe(
        !cloudflare,
      );
      expect(await f.page.locator("#tls-key").isVisible()).toBe(!cloudflare);
      expect(f.errors).toEqual([]);
    },
  );

  it.each(["initial-prepared-host", "ingress-prepared-host"] as const)(
    "does not expose irrelevant authentication inputs in %s",
    async (scope) => {
      const f = await fixture(false, {
        scope,
        current: model,
        preview: (review) => ({ review }),
        apply: () => {},
      });
      expect(await f.page.locator("#owner-login").isVisible()).toBe(
        scope === "initial-prepared-host",
      );
      expect(await f.page.locator("#owner-subject").isVisible()).toBe(false);
      expect(await f.page.locator("#oidc-secret").isVisible()).toBe(false);
      expect(await f.page.locator("#tls-key").isVisible()).toBe(true);
      expect(await f.page.locator("#confirmation").isVisible()).toBe(false);
      expect(await f.page.locator("#credentials-heading").textContent()).toBe(
        scope === "initial-prepared-host" ? "管理者と認証情報" : "HTTPS証明書",
      );
      expect(f.errors).toEqual([]);
    },
  );

  it("preserves reviewed settings through layout zoom and viewport rotation", async () => {
    const f = await fixture(true);
    await f.page.setViewportSize({ width: 780, height: 900 });
    await f.page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    const limit = f.page.getByRole("spinbutton", {
      name: "maxQueueLength",
      exact: true,
    });
    await limit.fill("42");
    expect(
      await f.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await f.page.evaluate(() => {
      document.documentElement.style.zoom = "1";
    });
    await f.page.setViewportSize({ width: 844, height: 390 });
    const review = f.page.getByRole("button", {
      name: "変更内容を確認",
      exact: true,
    });
    if (await f.page.evaluate(() => navigator.maxTouchPoints > 0))
      await review.tap();
    else await review.click();
    await f.page.waitForFunction(
      () => !document.getElementById("confirmation")?.hidden,
    );
    expect(f.preview.mock.calls[0]?.[0].runtime.limits.maxQueueLength).toBe(42);
    expect(f.apply).not.toHaveBeenCalled();
    expect(f.errors).toEqual([]);
  });

  it("exchanges/removes the fragment and works without storage or terminal switching", async () => {
    const f = await fixture();
    expect(f.page.url()).toBe(`${f.web.origin}/`);
    expect(
      await f.page.evaluate(() => ({
        local: localStorage.length,
        session: sessionStorage.length,
      })),
    ).toEqual({ local: 0, session: 0 });
    expect(await f.page.locator("#limits input").count()).toBe(
      Object.keys(model().runtime.limits).length,
    );
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
