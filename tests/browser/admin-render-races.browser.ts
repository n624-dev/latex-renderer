import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { Browser, Route } from "playwright";
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { adminRenderPage } from "../../apps/admin-web/src/templates-admin.js";
import { siteScript } from "../../apps/admin-web/src/assets/site-script.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";
import {
  zipSingleTex,
  zipStoredFiles,
} from "../../apps/admin-web/src/assets/render-script.js";

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
const origin = "https://renderer.invalid",
  sourceId = `source_${"a".repeat(32)}`;
const jobId = (n: number) => `job_${String(n).padStart(32, "0")}`;
let browser: Browser;
const pages: Awaited<ReturnType<typeof newTestPage>>[] = [];
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterEach(async () => {
  await Promise.all(pages.splice(0).map((page) => page.close()));
});
afterAll(async () => {
  await browser.close();
});

async function fixture(
  intercept: (route: Route) => Promise<boolean>,
  slowFile = false,
) {
  const page = await newTestPage(browser);
  page.setDefaultTimeout(8_000);
  pages.push(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if (slowFile)
    await page.addInitScript(() => {
      const original = File.prototype.arrayBuffer;
      File.prototype.arrayBuffer = async function () {
        const bytes = await original.call(this);
        if (this.name.startsWith("A."))
          await new Promise<void>((resolve) => {
            (
              globalThis as typeof globalThis & { releaseA?: () => void }
            ).releaseA = resolve;
          });
        return bytes;
      };
    });
  let next = 0;
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (await intercept(route)) return;
    if (url.pathname === "/admin/render")
      return route.fulfill({
        contentType: "text/html",
        body: adminRenderPage(),
      });
    if (url.pathname === "/admin/assets/render.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: script,
      });
    if (url.pathname === "/admin/assets/site.js")
      return route.fulfill({
        contentType: "application/javascript",
        body: siteScript,
      });
    if (url.pathname === "/admin/assets/styles.css")
      return route.fulfill({ contentType: "text/css", body: styles });
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
    if (url.pathname.endsWith("/source-tickets"))
      return route.fulfill({
        json: {
          sourceId,
          uploadRequired: true,
          uploadTicket: "fixture-upload",
          uploadUrl: `${origin}/api/v1/sources/${sourceId}/content`,
          expiresAt: "2099-01-01T00:00:00Z",
        },
      });
    if (url.pathname.endsWith("/render-tickets"))
      return route.fulfill({ json: ticket(++next) });
    if (route.request().method() === "PUT")
      return route.fulfill({ status: 204 });
    if (/^\/api\/v1\/jobs\/job_[a-f0-9]{32}$/.test(url.pathname))
      return route.fulfill({
        json: job(url.pathname.split("/").at(-1) ?? "", "succeeded"),
      });
    if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204 });
    errors.push(`Unexpected request: ${url.pathname}`);
    return route.abort();
  });
  await page.goto(`${origin}/admin/render`);
  return { page, errors };
}
function ticket(n: number) {
  return {
    jobId: jobId(n),
    jobTicket: `fixture-job-${n}`,
    uploadTicket: `fixture-upload-${n}`,
    uploadUrl: `${origin}/api/v1/jobs/${jobId(n)}/source`,
    expiresAt: "2099-01-01T00:00:00Z",
  };
}
function job(id: string, status: string) {
  return {
    id,
    status,
    errorCode: null,
    errorMessage: null,
    retentionExpiresAt: null,
    artifacts: [],
    previews: [],
  };
}
function zip(names = ["main.tex"], content = "Fixture") {
  return Buffer.from(
    zipStoredFiles(
      names.map((name) => ({ name, bytes: Buffer.from(content) })),
    ),
  );
}
async function prepare(page: (typeof pages)[number], names = ["main.tex"]) {
  await page.locator("#project-files").setInputFiles({
    name: "project.zip",
    mimeType: "application/zip",
    buffer: zip(names),
  });
  await page.locator("#inspect-files").click();
  await page.locator("#render-target").selectOption("key_fixture");
  await expect.poll(() => page.locator("#start-render").isEnabled()).toBe(true);
}

it.each(["zip", "tex"])(
  "only uploads the latest %s selection when the previous read completes late",
  async (extension) => {
    const uploads: Buffer[] = [],
      reservations: Record<string, unknown>[] = [];
    const f = await fixture(async (route) => {
      if (route.request().method() === "PUT") {
        const bytes = route.request().postDataBuffer();
        if (bytes === null) throw new Error("Expected archive body");
        uploads.push(bytes);
        await route.fulfill({ status: 204 });
        return true;
      }
      if (
        route.request().url().endsWith("/render-tickets") ||
        route.request().url().endsWith("/source-tickets")
      )
        reservations.push(
          route.request().postDataJSON() as Record<string, unknown>,
        );
      return false;
    }, true);
    const a =
      extension === "zip" ? zip(["main.tex"], "Old A") : Buffer.from("Old A");
    const b =
      extension === "zip"
        ? zip(["main.tex"], "Current B")
        : Buffer.from("Current B");
    const input = f.page.locator("#project-files");
    await input.setInputFiles({
      name: `A.${extension}`,
      mimeType: "application/octet-stream",
      buffer: a,
    });
    await f.page.locator("#inspect-files").click();
    await f.page.waitForFunction(() =>
      Boolean(
        (globalThis as typeof globalThis & { releaseA?: () => void }).releaseA,
      ),
    );
    await input.setInputFiles({
      name: `B.${extension}`,
      mimeType: "application/octet-stream",
      buffer: b,
    });
    await f.page.locator("#inspect-files").click();
    await expect
      .poll(() => f.page.locator("#render-selection").innerText())
      .toContain(`B.${extension}`);
    await f.page.evaluate(() =>
      (globalThis as typeof globalThis & { releaseA: () => void }).releaseA(),
    );
    // Let the old File read and crypto digest settle before pressing submit.
    await f.page.waitForTimeout(150);
    await f.page.locator("#render-target").selectOption("key_fixture");
    await f.page.locator("#start-render").click();
    await expect.poll(() => uploads.length).toBe(1);
    const expected = extension === "zip" ? b : Buffer.from(zipSingleTex(b));
    expect(uploads[0]).toEqual(expected);
    expect(reservations[0]?.sha256).toBe(
      createHash("sha256").update(expected).digest("hex"),
    );
    expect(f.errors).toEqual([]);
  },
);

it.each(
  [true, false].flatMap((legacy) => [
    { legacy, retry: false, cancelFailure: false },
    { legacy, retry: true, cancelFailure: false },
    { legacy, retry: false, cancelFailure: true },
  ]),
)(
  "honors cancellation during reservation (legacy=$legacy, retry=$retry, cancel failure=$cancelFailure)",
  async ({ legacy, retry, cancelFailure }) => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reserved = 0,
      canceled = 0,
      uploads = 0;
    const f = await fixture(async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/source-tickets")) {
        await route.fulfill({
          json: {
            sourceId,
            uploadRequired: false,
            expiresAt: "2099-01-01T00:00:00Z",
          },
        });
        return true;
      }
      if (path.endsWith("/render-tickets")) {
        reserved++;
        if (retry && reserved === 1) {
          await route.fulfill({
            status: 503,
            json: { error: { code: "QUEUE_FULL", message: "Retry fixture" } },
          });
          return true;
        }
        await gate;
        await route.fulfill({ json: ticket(1) });
        return true;
      }
      if (path.endsWith("/cancel")) {
        canceled++;
        await route.fulfill(
          cancelFailure
            ? {
                status: 503,
                json: {
                  error: {
                    code: "FIXTURE_CANCEL_FAILURE",
                    message: "Cancellation unavailable",
                  },
                },
              }
            : { status: 202, json: { status: "canceled" } },
        );
        return true;
      }
      if (route.request().method() === "PUT") {
        uploads++;
        await route.fulfill({ status: 204 });
        return true;
      }
      if (path === `/api/v1/jobs/${jobId(1)}`) {
        await route.fulfill({
          json: job(jobId(1), canceled ? "canceled" : "running"),
        });
        return true;
      }
      return false;
    });
    try {
      await prepare(f.page, legacy ? ["main.tex"] : ["other.tex"]);
      await f.page.locator("#start-render").click();
      await expect.poll(() => reserved).toBe(retry ? 2 : 1);
      await f.page.locator("#cancel-all-render").click();
      release();
      await expect.poll(() => canceled).toBe(1);
      if (cancelFailure) {
        await expect
          .poll(() => f.page.locator("#render-items").innerText())
          .toContain("中止を確認できませんでした");
        await expect
          .poll(() => f.page.locator("#project-files").isEnabled())
          .toBe(true);
        expect(await f.page.locator("#render-status").textContent()).not.toBe(
          "すべての処理が終了しました。",
        );
      } else {
        await expect
          .poll(() => f.page.locator("#render-status").textContent())
          .toBe("すべての処理が終了しました。");
      }
      expect(uploads).toBe(0);
      expect(f.errors).toEqual([]);
    } finally {
      release();
    }
  },
);

it("keeps monitoring a running Job when an inspection submit is forced", async () => {
  let completed = false,
    polls = 0;
  const f = await fixture(async (route) => {
    if (
      new URL(route.request().url()).pathname === `/api/v1/jobs/${jobId(1)}`
    ) {
      polls++;
      await route.fulfill({
        json: job(jobId(1), completed ? "succeeded" : "running"),
      });
      return true;
    }
    return false;
  });
  await prepare(f.page);
  await f.page.locator("#start-render").click();
  await expect.poll(() => polls).toBeGreaterThan(0);
  expect(await f.page.locator("#inspect-files").isDisabled()).toBe(true);
  await f.page
    .locator("#render-preflight")
    .evaluate((element) =>
      element.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      ),
    );
  await expect.poll(() => polls, { timeout: 5_000 }).toBeGreaterThan(1);
  expect(await f.page.locator("#project-files").isDisabled()).toBe(true);
  expect(await f.page.locator("#render-status").textContent()).not.toBe(
    "すべての処理が終了しました。",
  );
  completed = true;
  await expect
    .poll(() => f.page.locator("#inspect-files").isEnabled(), {
      timeout: 5_000,
    })
    .toBe(true);
  expect(await f.page.locator("#render-status").textContent()).toBe(
    "すべての処理が終了しました。",
  );
  expect(f.errors).toEqual([]);
});

it.each([false, true])(
  "tracks both retried Job IDs without duplicate creation (second response lost: %s)",
  async (loseSecond) => {
    let reservations = 0,
      retryRequests = 0,
      renewals = 0,
      lost = false;
    const retries = new Map<string, { id: string; retryOfJobId: string }>();
    const f = await fixture(async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/render-tickets")) {
        await route.fulfill({ json: ticket(++reservations) });
        return true;
      }
      if (path.endsWith("/retry")) {
        retryRequests++;
        const key = route.request().headers()["idempotency-key"];
        if (key === undefined) throw new Error("Missing retry idempotency key");
        const reply = retries.get(key) ?? {
          id: jobId(10 + retries.size),
          retryOfJobId: path.split("/").at(-2) ?? "",
        };
        retries.set(key, reply);
        if (loseSecond && retries.size === 2 && !lost) {
          lost = true;
          await route.abort("failed");
        } else await route.fulfill({ status: 202, json: reply });
        return true;
      }
      if (path.endsWith("/access-ticket")) {
        renewals++;
        const id = path.split("/").at(-2) ?? "";
        await route.fulfill({
          json: {
            jobId: id,
            jobTicket: `fixture-renewed-${id}`,
            expiresAt: "2099-01-01T00:00:00Z",
          },
        });
        return true;
      }
      if (/^\/api\/v1\/jobs\/job_[a-f0-9]{32}$/.test(path)) {
        const id = path.split("/").at(-1) ?? "";
        await route.fulfill({
          json: job(
            id,
            [jobId(1), jobId(2)].includes(id) ? "failed" : "succeeded",
          ),
        });
        return true;
      }
      return false;
    });
    await prepare(f.page, ["a.tex", "b.tex"]);
    await f.page.locator("#start-render").click();
    await expect
      .poll(() => f.page.locator("#retry-failed-render").isEnabled())
      .toBe(true);
    await f.page.locator("#retry-failed-render").click();
    await expect.poll(() => retries.size).toBe(2);
    if (loseSecond) {
      await expect
        .poll(() => f.page.locator("#retry-failed-render").isEnabled())
        .toBe(true);
      await f.page.locator("#retry-failed-render").click();
    }
    await expect
      .poll(() => f.page.locator("#render-items").innerText())
      .toContain(jobId(11));
    await expect.poll(() => renewals).toBe(2);
    await expect
      .poll(() => f.page.locator("#project-files").isEnabled())
      .toBe(true);
    expect(await f.page.locator("#retry-failed-render").isEnabled()).toBe(
      false,
    );
    expect(retries.size).toBe(2);
    expect(retryRequests).toBe(loseSecond ? 3 : 2);
    expect(f.errors).toEqual([]);
  },
);
