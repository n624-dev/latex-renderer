import { localizedAdminScript } from "../../apps/admin-web/src/assets/admin-script.js";
import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { routeWebFonts } from "../helpers/browser-web-fonts.js";
import {
  adminPage,
  adminDocsPage,
} from "../../apps/admin-web/src/templates-admin.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";
import { readBrowserAsset } from "../../apps/admin-web/src/browser-assets.js";

const script = localizedAdminScript("ja");
const origin = "https://renderer.invalid";
const userId = `user_${"a".repeat(32)}`;
const accountId = `sa_${"a".repeat(32)}`;
const requestedId = `sa_${"b".repeat(32)}`;
const fixtureCredential = "issued-credential-fixture-not-a-key";
const jobId = `job_${"c".repeat(32)}`;
const retryId = `job_${"f".repeat(32)}`;
const sourceId = `source_${"d".repeat(32)}`;
const user = {
  id: userId,
  display_name: "検証ユーザー",
  email: null,
  role: "owner",
  status: "active",
  identities: [],
  credential: { login_name: "owner" },
};
const account = {
  id: accountId,
  name: "最初の連携",
  owner_user_id: userId,
  client_type: "generic",
  status: "active",
};
const job = {
  id: jobId,
  status: "queued",
  artifacts: [],
  previews: [],
  retries: [],
  artifacts_available: true,
  source_id: sourceId,
  entrypoint: "main.tex",
  source_size: 100,
  created_at: "2026-10-19T00:00:00Z",
  retention_expires_at: "2026-10-20T00:00:00Z",
};
type JobFixture = Omit<typeof job, "previews"> & {
  error_message?: string;
  preview_page_count?: number;
  previews: Array<{
    open_url: string;
    relative_path: string;
    type: string;
    size: number;
    sha256: string;
  }>;
};
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

async function fixture(kind: string, query = "", pagedOwners = false, pagedAccounts = false) {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser, {
    viewport: { width: 390, height: 844 },
  });
  pages.push(page);
  const errors: string[] = [],
    mutations: Array<{
      path: string;
      csrf: string | undefined;
      body: string | null;
    }> = [];
  const ownerState = { disabled: false };
  const jobState: { current: JobFixture } = { current: job };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) {
      errors.push(`Unexpected origin ${url.origin}`);
      await route.abort();
      return;
    }
    if (request.method() === "POST") {
      mutations.push({
        path: url.pathname,
        csrf: request.headers()["x-csrf-token"],
        body: request.postData(),
      });
      await route.fulfill({
        json:
          url.pathname === `/admin/api/v1/jobs/${jobId}/retry`
            ? { id: retryId, retryOfJobId: jobId }
            : url.pathname.includes("/service-accounts/") && url.pathname.endsWith("/api-keys")
              ? { apiKey: fixtureCredential }
              : {},
      });
      return;
    }
    if (url.pathname === "/admin/assets/styles.css") {
      await route.fulfill({ contentType: "text/css", body: styles });
      return;
    }
    if (url.pathname === "/admin/assets/site.js") {
      await route.fulfill({ contentType: "text/javascript", body: readBrowserAsset("site") });
      return;
    }
    if (url.pathname === "/admin/assets/admin.js") {
      await route.fulfill({
        contentType: "text/javascript",
        body: script,
      });
      return;
    }
    if (url.pathname === "/auth/session") {
      await route.fulfill({ json: { csrfToken: "fixture-csrf" } });
      return;
    }
    if (url.pathname === "/auth/config") {
      await route.fulfill({ json: { mode: "password" } });
      return;
    }
    if (url.pathname === "/login/") {
      await route.fulfill({ contentType: "text/html", body: "ログアウト済み" });
      return;
    }
    if (!url.pathname.startsWith("/admin/api/v1")) {
      await route.fulfill({
        contentType: "text/html",
        body: kind === "docs" ? adminDocsPage() : adminPage(kind),
      });
      return;
    }
    const path = url.pathname.slice("/admin/api/v1".length);
    if (pagedAccounts && path === "/service-accounts") {
      const last = { ...account, id: requestedId, name: "別ページの連携" };
      const items = url.searchParams.has("query")
        ? url.searchParams.get("query") === last.name ? [last] : []
        : url.searchParams.has("cursor")
          ? [last]
          : Array.from({ length: 50 }, (_, n) => ({
              ...account, id: `sa_${String(n).padStart(32, "0")}`, name: `連携 ${n}`,
            }));
      await route.fulfill({ json: { items, nextCursor: items.length === 50 ? "next-account" : null } });
      return;
    }
    if (pagedOwners && path === "/users") {
      const items = url.searchParams.has("query")
        ? []
        : url.searchParams.has("cursor")
          ? [{ ...user, id: "user_last", display_name: "最後の所有者" }]
          : Array.from({ length: 50 }, (_, n) => ({
              ...user,
              id: `user_${n}`,
              display_name: `所有者 ${n}`,
            }));
      await route.fulfill({
        json: {
          items,
          nextCursor:
            url.searchParams.has("cursor") || url.searchParams.has("query")
              ? null
              : "next-owner",
        },
      });
      return;
    }
    if (pagedOwners && path === "/users/user_last") {
      await route.fulfill({
        json: {
          ...user,
          id: "user_last",
          status: ownerState.disabled ? "disabled" : "active",
        },
      });
      return;
    }
    const values: Record<string, unknown> = {
      "/me": { userId, displayName: "検証ユーザー", role: "owner" },
      "/users": { items: [user], nextCursor: null },
      "/service-accounts": { items: [account], nextCursor: "more" },
      [`/service-accounts/${requestedId}`]: {
        ...account,
        id: requestedId,
        name: "別ページの連携",
      },
      "/api-keys": {
        items: [
          {
            id: "key-fixture",
            name: "検証キー",
            prefix: "lrk_example",
            service_account_id: accountId,
          },
        ],
        nextCursor: null,
      },
      "/jobs": { items: [job], nextCursor: null },
      [`/jobs/${jobId}`]: jobState.current,
      [`/jobs/${retryId}`]: { ...job, id: retryId, retry_of_job_id: jobId },
      "/jobs/render-targets": { items: [] },
      "/sources": {
        items: [
          {
            id: sourceId,
            status: "ready",
            size: 100,
            entrypoints: ["main.tex"],
            jobCount: 1,
          },
        ],
        nextCursor: null,
      },
      [`/sources/${sourceId}`]: {
        id: sourceId,
        status: "ready",
        size: 100,
        sha256: "e".repeat(64),
        paths: ["main.tex"],
        entrypoints: ["main.tex"],
        jobs: [],
        deletable: false,
      },
      "/system/status": {
        maintenance: "normal",
        worker: "running",
        writeEnabled: true,
        httpServices: {
          managed: true,
          services: [
            {
              service: "latex-renderer-web.service",
              state: "running",
              operational: true,
            },
            {
              service: "latex-renderer-api.service",
              state: "idle",
              operational: true,
            },
            {
              service: "latex-renderer-internal-api.service",
              state: "starting",
              operational: false,
            },
            {
              service: "latex-renderer-admin-api.service",
              state: "running",
              operational: true,
            },
            {
              service: "latex-renderer-remote-mcp.service",
              state: "unavailable",
              operational: false,
            },
          ],
        },
      },
      "/system/config": { items: [] },
      "/system/ticket-keys": { activeKid: "fixture", verificationKids: [] },
      "/backups/status": {
        backup: { active: "inactive", result: "success" },
        verification: { active: "inactive", result: "success" },
        latestVerification: null,
      },
      "/audit-logs": {
        items: [],
        total: 0,
        page: 1,
        pageSize: 50,
        totalPages: 0,
      },
    };
    if (!(path in values)) {
      errors.push(`Unexpected API ${path}`);
      await route.abort();
      return;
    }
    await route.fulfill({ json: values[path] });
  });
  const path =
    kind === "accounts"
      ? "service-accounts"
      : kind === "keys"
        ? "api-keys"
        : kind === "audit"
          ? "audit-logs"
          : kind;
  await routeWebFonts(page, origin);
  await page.goto(`${origin}/admin/${path}/${query}`);
  if (kind !== "docs") {
    await page.waitForFunction(
      () => Boolean(document.querySelector("#updated")?.textContent ||
        document.querySelector("#error")?.textContent),
      undefined,
      { timeout: 15_000 },
    );
    expect(await page.locator("#error").textContent()).toBe("");
    expect(errors).toEqual([]);
  }
  return { page, errors, mutations, ownerState, jobState };
}

it.each([false, true])(
  "selects an owner beyond the first page without silently changing it after search: disabled=%s",
  async (disabled) => {
    const { page, errors, mutations, ownerState } = await fixture(
      "accounts",
      "",
      true,
    );
    await page.locator("#account-create").click();
    const select = page.locator('[name="ownerUserId"]');
    expect(await select.inputValue()).toBe("");
    expect(await select.locator("option").count()).toBe(51);
    await page.locator("[data-owner-next]").click();
    await expect.poll(() => select.locator("option").count()).toBe(2);
    await select.selectOption("user_last");
    await page.locator("[data-owner-query]").fill("no matching user");
    await page.locator("[data-owner-search]").click();
    await expect
      .poll(() => page.locator("[data-owner-error]").textContent())
      .toContain("有効なユーザーはいません");
    expect(await select.inputValue()).toBe("user_last");
    await page.locator('dialog [name="name"]').fill("ページ外の所有者用");
    ownerState.disabled = disabled;
    await page.locator('dialog button[type="submit"]').click();
    if (disabled) {
      await expect
        .poll(() => page.locator(".dialog-error").textContent())
        .toContain("有効な所有者");
      expect(mutations).toEqual([]);
    } else {
      await page.waitForFunction(() => !document.querySelector("dialog form"));
      await page.waitForFunction(() => Boolean(document.querySelector("#success")?.textContent));
      expect(mutations[0]?.path).toBe("/admin/api/v1/service-accounts");
      expect(mutations[0]?.csrf).toBe("fixture-csrf");
      expect(JSON.parse(mutations[0]?.body ?? "{}")).toMatchObject({
        ownerUserId: "user_last",
      });
    }
    expect(errors).toEqual([]);
  },
);

it.each([
  "dashboard",
  "users",
  "accounts",
  "keys",
  "jobs",
  "sources",
  "system",
  "audit",
  "docs",
])(
  "keeps %s controls usable on phones, tablets, desktop and 200 percent layout zoom",
  async (kind) => {
    const { page, errors } = await fixture(kind);
    if (kind !== "docs")
      await page.waitForFunction(() =>
        Boolean(document.querySelector("#updated")?.textContent),
      );
    if (kind === "system") {
      expect(
        await page
          .getByText("待機中（アクセス時に起動）", { exact: true })
          .count(),
      ).toBe(1);
      expect(await page.getByText("利用不可", { exact: true }).count()).toBe(1);
      expect(
        await page.getByRole("button", { name: "バックアップを作成" }).count(),
      ).toBe(1);
    }
    for (const width of [390, 768, 960, 1200]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(await page.locator(".admin-nav a").count()).toBe(11);
    }
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(await page.locator(".eyebrow").count()).toBe(0);
    expect(errors).toEqual([]);
  },
);

it("selects an explicit account outside the first page and keeps scope labels aligned", async () => {
  const { page, errors, mutations } = await fixture(
    "keys",
    `?account=${requestedId}`,
  );
  await page.locator("#key-create").click();
  expect(await page.locator('[name="account"]').inputValue()).toBe(requestedId);
  expect(await page.locator('[name="scope"]:checked').count()).toBe(2);
  expect(await page.locator('[data-key-kind="admin"]').isVisible()).toBe(false);
  const draftRead = page.locator('input[name="scope"][value="render:draft:read"]');
  expect(await draftRead.isChecked()).toBe(false);
  await draftRead.check();
  const aligned = await page
    .locator("label.check")
    .first()
    .evaluate((label) => {
      const input = label.querySelector("input"),
        text = label.querySelector("span");
      if (!input || !text) throw new Error("Missing scope layout");
      return (
        input.getBoundingClientRect().right < text.getBoundingClientRect().left
      );
    });
  expect(aligned).toBe(true);
  await page.locator('[name="name"]').fill("新規キー");
  await page.locator('dialog button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector("dialog form"));
  expect(mutations[0]?.path).toBe(
    `/admin/api/v1/service-accounts/${requestedId}/api-keys`,
  );
  expect(mutations[0]?.csrf).toBe("fixture-csrf");
  expect(JSON.parse(mutations[0]?.body ?? "{}")).toMatchObject({
    scopes: ["render:create", "render:read:own", "render:draft:read"],
  });
  const value = page.locator("[data-issued-credential]");
  await expect.poll(() => value.textContent()).toBe(fixtureCredential);
  expect(await page.evaluate(() => [...Object.values(sessionStorage), ...Object.values(localStorage)]
    .some((entry) => entry.includes("issued-credential-fixture-not-a-key")))).toBe(false);
  await page.keyboard.press("Escape");
  await value.waitFor({ state: "detached" });
  expect(errors).toEqual([]);
});

it("pages and searches API key accounts beyond the first 50 results", async () => {
  const { page, errors } = await fixture("keys", "", false, true);
  await page.locator("#key-create").click();
  const select = page.locator('[name="account"]');
  expect(await select.locator("option").count()).toBe(50);
  await page.locator("[data-account-next]").click();
  await select.locator(`option[value="${requestedId}"]`).waitFor({ state: "attached" });
  await select.selectOption(requestedId);
  await page.locator("[data-account-query]").fill("別ページの連携");
  await page.locator("[data-account-search]").click();
  await expect.poll(() => select.locator("option").count()).toBe(2);
  expect(await select.inputValue()).toBe(requestedId);
  expect(errors).toEqual([]);
});

it("opens the newly created Job after an administrator retry", async () => {
  const { page, errors, mutations, jobState } = await fixture("jobs", `?job=${jobId}`);
  await page.locator("#job-technical").waitFor({ state: "attached" });
  jobState.current = { ...job, status: "failed" };
  await page.locator("#refresh").click();
  await page.locator("[data-j-retry]").click();
  await page.locator('dialog button[type="submit"]').click();
  await page.waitForURL(`${origin}/admin/jobs/?job=${retryId}`);
  expect(mutations).toEqual([
    {
      path: `/admin/api/v1/jobs/${jobId}/retry`,
      csrf: "fixture-csrf",
      body: "{}",
    },
  ]);
  expect(errors).toEqual([]);
});

it("keeps a job's chosen disclosures across a status refresh", async () => {
  const { page, errors, jobState } = await fixture("jobs", `?job=${jobId}`);
  await page.locator("#job-technical").waitFor({ state: "attached" });
  await page.locator("#job-technical summary").click();
  await page.locator("#artifact-panel summary").click();
  jobState.current = { ...job, status: "failed", error_message: "fixture error" };
  await page.locator("#refresh").click();
  await expect.poll(() => page.locator(".error-summary").textContent()).toBe("fixture error");
  expect(
    await page.locator("#job-technical").getAttribute("open"),
  ).not.toBeNull();
  expect(
    await page.locator("#artifact-panel").getAttribute("open"),
  ).not.toBeNull();
  expect(await page.locator(".error-summary").textContent()).toBe(
    "fixture error",
  );
  expect(errors).toEqual([]);
});

it("logs out from the static API documentation with session-specific CSRF", async () => {
  const { page, errors, mutations } = await fixture("docs");
  await page.locator(".header-options summary").click();
  await page.locator("[data-session-logout]").click();
  await page.waitForURL(`${origin}/login/`);
  expect(mutations).toEqual([
    { path: "/auth/logout", csrf: "fixture-csrf", body: null },
  ]);
  expect(errors).toEqual([]);
});

it("navigates ungenerated pages, retries a pending PNG and does not fetch untouched pages", async () => {
  const { page, errors, jobState } = await fixture("jobs", `?job=${jobId}`);
  const requested: number[] = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
    "base64",
  );
  await page.route("**/admin/api/v1/jobs/*/previews/*", async (route) => {
    const number = Number(/page-(\d+)\.png/.exec(route.request().url())?.[1]);
    requested.push(number);
    if (number === 2 && requested.filter((p) => p === 2).length === 1)
      await route.fulfill({
        status: 503,
        json: { error: { code: "PREVIEW_PENDING" } },
        headers: { "Retry-After": "2" },
      });
    else await route.fulfill({ contentType: "image/png", body: png });
  });
  jobState.current = {
      ...job,
      status: "succeeded",
      preview_page_count: 3,
      previews: [
        {
          open_url: `/admin/api/v1/jobs/${jobId}/previews/page-1.png`,
          relative_path: "previews/page-1.png",
          type: "preview",
          size: png.length,
          sha256: "a".repeat(64),
        },
      ],
  };
  await page.locator("#refresh").click();
  await page.locator("#job-preview").waitFor({ state: "visible" });
  expect(await page.locator("#preview-count").textContent()).toBe("1 / 3");
  await page.locator("#preview-next").click();
  await page.waitForFunction(
    () =>
      document.querySelector("#preview-message")?.textContent ===
      "プレビュー生成を待っています…",
  );
  await page.waitForFunction(() => {
    const img = document.querySelector<HTMLImageElement>("#job-preview");
    return Boolean(
      img &&
      !img.hidden &&
      img.alt === "2ページ目のプレビュー" &&
      img.naturalWidth > 0,
    );
  });
  expect(requested.filter((p) => p === 2)).toHaveLength(2);
  expect(requested).not.toContain(3);
  expect(await page.locator("#preview-count").textContent()).toBe("2 / 3");
  expect(errors).toEqual([]);
});
