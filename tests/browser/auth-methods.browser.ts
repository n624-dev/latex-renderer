import { execFileSync } from "node:child_process";
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
import { loginPage } from "../../apps/admin-web/src/templates-pages.js";
import { adminPage } from "../../apps/admin-web/src/templates-admin.js";

// Execute the production build, not Vitest's function.toString() SSR transform.
function shippedScript(file: string, name: string): string {
  return execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const m=await import(process.argv[1]);process.stdout.write(m[process.argv[2]]);",
      new URL(`../../apps/admin-web/dist/assets/${file}.js`, import.meta.url)
        .href,
      name,
    ],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
  );
}
const loginScript = shippedScript("login-script", "loginScript");
const adminScript = shippedScript("admin-script", "adminScript");
const origin = "http://127.0.0.1:43129";
const password = { id: "password" };
const oidc = { id: "oidc", displayName: "School Account" };
const native = (methods: unknown[]) => ({ backend: "native", methods });
const dual = native([password, oidc]);
const cloudflare = { backend: "cloudflare-access", methods: [] };
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

function gate() {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { pending, release };
}

interface FixtureOptions {
  config?: unknown;
  configFailure?: "http" | "json";
  admin?: boolean;
  sessionMode?: string;
  role?: string;
  configGate?: ReturnType<typeof gate>;
  loginGate?: ReturnType<typeof gate>;
  loginFails?: boolean;
  sessionFails?: boolean;
  query?: string;
}

async function fixture(options: FixtureOptions = {}) {
  if (!browser) throw new Error("Browser not started");
  const page = await browser.newPage();
  pages.push(page);
  const state = { config: options.config ?? dual, invalidJson: false };
  const errors: string[] = [],
    unexpected: string[] = [];
  const writes: { path: string; body: unknown; csrf: string | undefined }[] =
    [];
  const sessionReads: string[] = [];
  const configRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) {
      unexpected.push(request.url());
      await route.abort();
      return;
    }
    const respond = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (url.pathname === "/auth/config") {
      configRequests.push(url.pathname);
      await options.configGate?.pending;
      if (options.configFailure === "http") {
        await respond(
          { error: { message: "fixture config unavailable" } },
          503,
        );
      } else if (state.invalidJson || options.configFailure === "json") {
        await route.fulfill({
          contentType: "application/json",
          body: "not-json",
        });
      } else await respond(state.config);
    } else if (url.pathname === "/auth/session") {
      sessionReads.push(url.pathname);
      if (options.sessionFails)
        await respond({ error: { message: "fixture access denied" } }, 401);
      else
        await respond({
          csrfToken: "fixture-csrf",
          authMode: options.sessionMode ?? "oidc",
        });
    } else if (url.pathname === "/admin/api/v1/me") {
      await respond({
        userId: "user_owner",
        role: options.role ?? "owner",
        displayName: "Owner",
      });
    } else if (
      url.pathname === "/admin/api/v1/users" &&
      request.method() === "GET"
    ) {
      await respond({
        items: [
          {
            id: "user_member",
            display_name: "Member",
            role: "user",
            status: "active",
            email: null,
            credential: { login_name: "member" },
            identities: [{ id: "identity_member", provider: "oidc" }],
          },
        ],
        nextCursor: null,
      });
    } else if (
      url.pathname === "/admin/api/v1/users" ||
      url.pathname === "/auth/password/login"
    ) {
      writes.push({
        path: url.pathname,
        body: request.postDataJSON(),
        csrf: request.headers()["x-csrf-token"],
      });
      await options.loginGate?.pending;
      await respond(
        options.loginFails
          ? { error: { message: "fixture login denied" } }
          : { ok: true },
        options.loginFails ? 401 : 200,
      );
    } else if (url.pathname === "/login/" || url.pathname === "/admin/users/") {
      await route.fulfill({
        contentType: "text/html",
        body: options.admin ? adminPage("users") : loginPage(),
      });
    } else if (
      url.pathname === "/assets/login.js" ||
      url.pathname === "/admin/assets/admin.js"
    ) {
      await route.fulfill({
        contentType: "application/javascript",
        body: options.admin ? adminScript : loginScript,
      });
    } else if (
      url.pathname.endsWith("styles.css") ||
      url.pathname.endsWith("site.js")
    ) {
      await route.fulfill({
        contentType: url.pathname.endsWith(".css")
          ? "text/css"
          : "application/javascript",
        body: "",
      });
    } else if (
      url.pathname === "/auth/oidc/start" ||
      url.pathname === "/app/" ||
      url.pathname === "/app/history/"
    ) {
      await route.fulfill({
        contentType: "text/html",
        body: "<h1>Navigation completed</h1>",
      });
    } else {
      unexpected.push(url.pathname);
      await route.abort();
    }
  });
  await page.goto(
    origin +
      (options.admin ? "/admin/users/" : "/login/") +
      (options.query ?? ""),
    { waitUntil: "domcontentloaded" },
  );
  return {
    page,
    state,
    writes,
    errors,
    unexpected,
    sessionReads,
    configRequests,
  };
}

async function ready(page: Page, admin = false) {
  try {
    await page
      .locator(admin ? "#user-create" : "#login-methods button")
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  } catch (error) {
    const messages = await page
      .locator("#error, #login-message")
      .allTextContents();
    throw new Error(
      `Authentication UI did not become ready: ${messages.join("; ")}`,
      { cause: error },
    );
  }
}

// Wait for explicit fixture/UI conditions, allowing slow local/CI scheduling.
// No test retry: an actual application failure still fails within this bound.
function waitFor(assertion: () => void | Promise<void>) {
  return vi.waitFor(assertion, { timeout: 10_000, interval: 50 });
}

describe("shipped login UI", () => {
  it.each(["http", "json"] as const)(
    "shows configuration %s failures without alternative login controls",
    async (configFailure) => {
      const { page, errors, writes, sessionReads } = await fixture({
        configFailure,
      });
      await waitFor(async () =>
        expect(
          await page.locator("#login-message").textContent(),
        ).not.toContain("確認しています"),
      );
      expect(await page.locator("#login-message").textContent()).not.toBe("");
      expect(
        await page
          .locator("#login-methods button, #login-methods input")
          .count(),
      ).toBe(0);
      expect(writes).toEqual([]);
      expect(sessionReads).toEqual([]);
      expect(errors).toEqual([]);
    },
  );
  it.each([
    [native([password]), true, false],
    [native([oidc]), false, true],
    [dual, true, true],
    [cloudflare, false, true],
    [{ mode: "password" }, true, false],
    [{ mode: "oidc" }, false, true],
    [{ mode: "cloudflare-access" }, false, true],
  ])(
    "renders only enabled methods: %j",
    async (config, hasPassword, hasExternal) => {
      const { page, errors, unexpected } = await fixture({ config });
      await ready(page);
      expect(await page.locator("#password-login").count()).toBe(
        Number(hasPassword),
      );
      expect(await page.locator("#external-login").count()).toBe(
        Number(hasExternal),
      );
      if (hasPassword) {
        expect(
          await page.locator('[name="password"]').getAttribute("autocomplete"),
        ).toBe("current-password");
        expect(
          await page.locator('[name="password"]').getAttribute("minlength"),
        ).toBe("12");
      }
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  );

  it("does not pre-render credentials before configuration is received", async () => {
    const configGate = gate();
    const { page, configRequests } = await fixture({ configGate });
    try {
      await waitFor(() => expect(configRequests).toHaveLength(1));
      expect(
        await page.locator("#password-login, #external-login").count(),
      ).toBe(0);
      expect(await page.locator("#login-message").textContent()).toContain(
        "確認しています",
      );
    } finally {
      configGate.release();
    }
    await ready(page);
  });

  it.each([
    {},
    { mode: "typo" },
    { ...dual, methods: [] },
    { mode: "password", backend: "native" },
  ])("fails closed for invalid config: %j", async (config) => {
    const { page, errors, sessionReads } = await fixture({ config });
    await waitFor(async () =>
      expect(await page.locator("#login-message").textContent()).toContain(
        "管理者へ",
      ),
    );
    expect(
      await page.locator("#login-methods input, #login-methods button").count(),
    ).toBe(0);
    expect(sessionReads).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("treats a provider display label as literal text", async () => {
    const label = '<img src=x onerror="window.injected=true">';
    const { page, unexpected } = await fixture({
      config: native([{ ...oidc, displayName: label }]),
    });
    await ready(page);
    expect(await page.locator("#external-login").textContent()).toBe(
      label + "でログイン",
    );
    expect(await page.locator("#login-methods img").count()).toBe(0);
    expect(await page.evaluate(() => Object.hasOwn(window, "injected"))).toBe(
      false,
    );
    expect(unexpected).toEqual([]);
  });

  it("sends one password request, permits retry on failure, and retains the OIDC option", async () => {
    const loginGate = gate();
    const { page, writes, errors } = await fixture({
      loginGate,
      loginFails: true,
    });
    await ready(page);
    await page.locator('[name="loginName"]').fill("member");
    await page.locator('[name="password"]').fill("fixture-password-123");
    try {
      await page.locator("#password-login").evaluate((form) => {
        form.dispatchEvent(new Event("submit", { cancelable: true }));
        form.dispatchEvent(new Event("submit", { cancelable: true }));
      });
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]?.body).toEqual({
        loginName: "member",
        password: "fixture-password-123",
      });
      expect(await page.locator("#password-login button").isDisabled()).toBe(
        true,
      );
      expect(await page.locator("#external-login").isEnabled()).toBe(true);
    } finally {
      loginGate.release();
    }
    await waitFor(async () =>
      expect(await page.locator("#password-login button").isEnabled()).toBe(
        true,
      ),
    );
    expect(await page.locator("#login-message").textContent()).toContain(
      "fixture login denied",
    );
    await page.locator("#password-login button").click();
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(errors).toEqual([]);
  });

  it("finishes password login at the fixed safe return path", async () => {
    const { page, writes } = await fixture({
      query: "?return_to=%2Fapp%2Fhistory%2F",
    });
    await ready(page);
    await page.locator('[name="loginName"]').fill("member");
    await page.locator('[name="password"]').fill("fixture-password-123");
    await page.locator("#password-login button").click();
    await page.waitForURL(origin + "/app/history/");
    expect(writes).toHaveLength(1);
  });

  it.each([
    "/app/history/",
    "//evil.example/",
    "/\\evil.example/",
    "/bad\npath",
    "/" + "x".repeat(2048),
  ])(
    "preserves safe OIDC return paths and rejects unsafe ones: %s",
    async (candidate) => {
      const { page, writes } = await fixture({
        config: native([oidc]),
        query: "?return_to=" + encodeURIComponent(candidate),
      });
      await ready(page);
      await page.locator("#external-login").click();
      await page.waitForURL((url) => url.pathname === "/auth/oidc/start");
      expect(new URL(page.url()).searchParams.get("return_to")).toBe(
        candidate === "/app/history/" ? candidate : "/app/",
      );
      expect(writes).toEqual([]);
    },
  );

  it("uses only the Access session endpoint for the Cloudflare backend", async () => {
    const { page, sessionReads, writes } = await fixture({
      config: cloudflare,
    });
    await ready(page);
    await page.locator("#external-login").click();
    await page.waitForURL(origin + "/app/");
    expect(sessionReads).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it("permits retry after an Access session failure without enabling native methods", async () => {
    const { page, sessionReads, writes, errors } = await fixture({
      config: cloudflare,
      sessionFails: true,
    });
    await ready(page);
    await page.locator("#external-login").click();
    await waitFor(async () =>
      expect(await page.locator("#login-message").textContent()).toContain(
        "fixture access denied",
      ),
    );
    expect(await page.locator("#external-login").isEnabled()).toBe(true);
    expect(await page.locator("#password-login").count()).toBe(0);
    await page.locator("#external-login").click();
    await waitFor(() => expect(sessionReads).toHaveLength(2));
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
});

describe("shipped admin authentication controls", () => {
  it("waits for admin initialization when configuration takes more than one second", async () => {
    const configGate = gate();
    const { page, errors, writes } = await fixture({ admin: true, configGate });
    const timer = setTimeout(() => configGate.release(), 1_500);
    try {
      await ready(page, true);
      expect(await page.locator("[data-u-password]").count()).toBe(1);
      expect(errors).toEqual([]);
      expect(writes).toEqual([]);
    } finally {
      clearTimeout(timer);
      configGate.release();
    }
  });

  it.each([
    [native([password]), "oidc", "owner", true, true, false],
    [native([oidc]), "password", "owner", false, false, true],
    [dual, "oidc", "owner", true, true, false],
    [dual, "password", "admin", false, true, false],
    [cloudflare, "cloudflare-access", "owner", false, false, true],
  ])(
    "uses configured capabilities, not session provenance: %j / %s / %s",
    async (config, sessionMode, role, canReset, hasPassword, hasSubject) => {
      const { page, errors, unexpected } = await fixture({
        admin: true,
        config,
        sessionMode,
        role,
      });
      await ready(page, true);
      expect(await page.locator("[data-u-password]").count()).toBe(
        Number(canReset),
      );
      expect(await page.locator('td[data-label="認証"]').textContent()).toBe(
        "password, oidc",
      );
      await page.locator("#user-create").click();
      expect(await page.locator('dialog [name="password"]').count()).toBe(
        Number(hasPassword),
      );
      expect(await page.locator('dialog [name="subject"]').count()).toBe(
        Number(hasSubject),
      );
      expect(
        await page
          .locator('dialog [name="role"] option[value="owner"]')
          .count(),
      ).toBe(role === "owner" ? 1 : 0);
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    },
  );

  it.each(["password", "external"])(
    "submits only the selected %s fields with CSRF protection",
    async (type) => {
      const label = '<img src=x onerror="window.injected=true">';
      const { page, writes, errors } = await fixture({
        admin: true,
        config: native([password, { ...oidc, displayName: label }]),
      });
      await ready(page, true);
      await page.locator("#user-create").click();
      const dialog = page.locator("dialog");
      await dialog.locator('[name="displayName"]').fill("New Member");
      await dialog.locator('[name="email"]').fill("member@example.invalid");
      await dialog.locator('[name="password"]').fill("discard-this-password");
      await dialog
        .locator('[name="authenticationType"]')
        .selectOption("external");
      expect(await dialog.locator('[name="password"]').count()).toBe(0);
      expect(
        await dialog
          .locator('[name="authenticationType"] option[value="external"]')
          .textContent(),
      ).toBe(label);
      expect(await dialog.locator("img").count()).toBe(0);
      let authentication: unknown;
      if (type === "password") {
        await dialog
          .locator('[name="authenticationType"]')
          .selectOption("password");
        expect(await dialog.locator('[name="subject"]').count()).toBe(0);
        expect(await dialog.locator('[name="password"]').inputValue()).toBe("");
        await dialog.locator('[name="loginName"]').fill("new-member");
        await dialog.locator('[name="password"]').fill("fixture-password-123");
        authentication = {
          type: "password",
          loginName: "new-member",
          password: "fixture-password-123",
        };
      } else {
        await dialog
          .locator('[name="subject"]')
          .fill("explicit-provider-subject");
        authentication = {
          type: "external",
          subject: "explicit-provider-subject",
        };
      }
      await dialog.locator('button[type="submit"]').click();
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0]).toEqual({
        path: "/admin/api/v1/users",
        csrf: "fixture-csrf",
        body: {
          email: "member@example.invalid",
          displayName: "New Member",
          role: "user",
          authentication,
        },
      });
      await waitFor(async () =>
        expect(await page.locator("dialog").count()).toBe(0),
      );
      expect(errors).toEqual([]);
    },
  );

  it.each(["bad-selection", "invalid-json"])(
    "removes stale controls when config refresh fails: %s",
    async (failure) => {
      const { page, state, writes, errors } = await fixture({ admin: true });
      await ready(page, true);
      if (failure === "invalid-json") state.invalidJson = true;
      else state.config = { backend: "native", methods: [] };
      await page.locator("#refresh").click();
      await waitFor(async () =>
        expect(await page.locator("#error").textContent()).not.toBe(""),
      );
      expect(
        await page.locator("#user-create, [data-u-password]").count(),
      ).toBe(0);
      expect(writes).toEqual([]);
      expect(errors).toEqual([]);
    },
  );
});
