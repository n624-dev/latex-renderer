import { execFileSync } from "node:child_process";
import type { Browser, Page } from "playwright";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import {
  adminPage,
  adminDocsPage,
} from "../../apps/admin-web/src/templates-admin.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";
import { siteScript } from "../../apps/admin-web/src/assets/site-script.js";

const script = execFileSync(
  process.execPath,
  [
    "--input-type=module",
    "--eval",
    "const m=await import(process.argv[1]);process.stdout.write(m.adminScript)",
    new URL("../../apps/admin-web/dist/assets/admin-script.js", import.meta.url)
      .href,
  ],
  { encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
);
const origin = "https://renderer.invalid";
const userId = `user_${"a".repeat(32)}`;
const accountId = `sa_${"a".repeat(32)}`;
const requestedId = `sa_${"b".repeat(32)}`;
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

async function fixture(kind: string, query = "", pagedOwners = false) {
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
            : {},
      });
      return;
    }
    if (url.pathname === "/admin/assets/styles.css") {
      await route.fulfill({ contentType: "text/css", body: styles });
      return;
    }
    if (url.pathname === "/admin/assets/site.js") {
      await route.fulfill({ contentType: "text/javascript", body: siteScript });
      return;
    }
    if (url.pathname === "/admin/assets/admin.js") {
      await route.fulfill({
        contentType: "text/javascript",
        body: script + "\nwindow.renderJobFixture=jobDetail;",
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
      [`/jobs/${jobId}`]: job,
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
      },
      "/system/config": { items: [] },
      "/system/ticket-keys": { activeKid: "fixture", verificationKids: [] },
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
  await page.goto(`${origin}/admin/${path}/${query}`);
  if (kind !== "docs") {
    await page.waitForFunction(
      () =>
        typeof (window as typeof window & { renderJobFixture?: unknown })
          .renderJobFixture === "function",
    );
    await page.locator("#updated").waitFor({ state: "attached" });
  }
  return { page, errors, mutations, ownerState };
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
  expect(errors).toEqual([]);
});

it("opens the newly created Job after an administrator retry", async () => {
  const { page, errors, mutations } = await fixture("jobs", `?job=${jobId}`);
  await page.locator("#job-technical").waitFor({ state: "attached" });
  await page.evaluate(async (next) => {
    const render = (
      window as typeof window & {
        renderJobFixture: (id: string, job: unknown) => Promise<unknown>;
      }
    ).renderJobFixture;
    await render(next.id, { ...next, status: "failed" });
  }, job);
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
  const { page, errors } = await fixture("jobs", `?job=${jobId}`);
  await page.locator("#job-technical").waitFor({ state: "attached" });
  await page.locator("#job-technical summary").click();
  await page.locator("#artifact-panel summary").click();
  await page.evaluate(async (next) => {
    const render = (
      window as typeof window & {
        renderJobFixture: (id: string, job: unknown) => Promise<unknown>;
      }
    ).renderJobFixture;
    await render(next.id, {
      ...next,
      status: "failed",
      error_message: "fixture error",
    });
  }, job);
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
  const { page, errors } = await fixture("jobs");
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
  await page.evaluate(
    async (next) => {
      const render = (
        window as typeof window & {
          renderJobFixture: (id: string, job: unknown) => Promise<unknown>;
        }
      ).renderJobFixture;
      await render(next.id, next);
    },
    {
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
    },
  );
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
      img.alt === "PDF 2ページ目のプレビュー" &&
      img.naturalWidth > 0,
    );
  });
  expect(requested.filter((p) => p === 2)).toHaveLength(2);
  expect(requested).not.toContain(3);
  expect(await page.locator("#preview-count").textContent()).toBe("2 / 3");
  expect(errors).toEqual([]);
});
