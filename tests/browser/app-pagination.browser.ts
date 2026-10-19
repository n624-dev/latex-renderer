import { execFileSync } from "node:child_process";
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
import {
  appHistoryPage,
  appProjectPage,
  appProjectsPage,
} from "../../apps/admin-web/src/templates-app.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";

// Use the built browser script: Vitest's SSR transform changes function.toString().
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
const origin = "http://127.0.0.1:43128";
const projectId = `project_${"a".repeat(32)}`;
type Kind = "jobs" | "projects" | "revisions" | "revisionJobs";
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

function pageFor(kind: Kind): string {
  return kind === "jobs"
    ? "/app/history/"
    : kind === "projects"
      ? "/app/projects/"
      : `/app/projects/${projectId}/`;
}

function nextButtonFor(kind: Kind): string {
  return kind === "jobs"
    ? "#app-jobs-next"
    : kind === "projects"
      ? "#app-projects-next"
      : kind === "revisionJobs"
        ? "[data-revision-jobs-next]"
        : "#app-revisions-next";
}

function pageData(kind: Kind, second: boolean): unknown {
  if (kind === "revisionJobs") {
    const job = (number: string) => ({
      id: `job_${number.repeat(32)}`,
      status: "succeeded",
      createdAt: "2026-10-19T00:00:00.000Z",
      outputs: ["pdf"],
    });
    return second
      ? { items: [job("2")], hasMore: false, nextCursor: null }
      : {
          displayName: "Project",
          revisions: [
            {
              id: "revision_1",
              revisionNumber: 1,
              displayName: "First revision",
              originalFilename: "main.tex",
              entrypoint: "main.tex",
              createdAt: "2026-10-19T00:00:00.000Z",
              jobs: [job("1")],
              jobCount: 2,
              jobsHasMore: true,
              jobsNextCursor: "next",
            },
          ],
          revisionsHasMore: false,
          revisionsNextCursor: null,
        };
  }
  if (kind === "jobs")
    return {
      items: [
        {
          id: `job_${(second ? "2" : "1").repeat(32)}`,
          documentName: second ? "Second job" : "First job",
          status: "succeeded",
          createdAt: "2026-09-28T00:00:00.000Z",
        },
      ],
      hasMore: !second,
      nextCursor: second ? null : "next",
    };
  if (kind === "projects")
    return {
      items: [
        {
          id: `project_${(second ? "2" : "1").repeat(32)}`,
          displayName: second ? "Second project" : "First project",
          revisionCount: 1,
          updatedAt: "2026-09-28T00:00:00.000Z",
        },
      ],
      hasMore: !second,
      nextCursor: second ? null : "next",
    };
  return {
    displayName: "Project",
    revisions: [
      {
        id: `revision_${second ? "2" : "1"}`,
        revisionNumber: second ? 2 : 1,
        displayName: second ? "Second revision" : "First revision",
        originalFilename: "main.tex",
        entrypoint: "main.tex",
        createdAt: "2026-09-28T00:00:00.000Z",
        jobs: [],
        jobCount: 0,
        jobsHasMore: false,
      },
    ],
    revisionsHasMore: !second,
    revisionsNextCursor: second ? null : "next",
  };
}

async function fixture(kind: Kind) {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser);
  pages.push(page);
  const errors: string[] = [];
  const cursors: Array<string | null> = [];
  let releaseSecond = () => {};
  const secondGate = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      errors.push(`unexpected origin: ${url.origin}`);
      await route.abort();
      return;
    }
    if (url.pathname === pageFor(kind)) {
      await route.fulfill({
        contentType: "text/html",
        body:
          kind === "jobs"
            ? appHistoryPage()
            : kind === "projects"
              ? appProjectsPage()
              : appProjectPage(),
      });
      return;
    }
    if (url.pathname === "/app/assets/app.js") {
      await route.fulfill({ contentType: "text/javascript", body: appScript });
      return;
    }
    if (url.pathname === "/app/assets/styles.css") {
      await route.fulfill({ contentType: "text/css", body: styles });
      return;
    }
    if (url.pathname === "/app/assets/site.js") {
      await route.fulfill({ contentType: "text/javascript", body: "" });
      return;
    }
    if (url.pathname === "/auth/session") {
      await route.fulfill({ json: { csrfToken: "test-csrf" } });
      return;
    }
    if (url.pathname === "/app/api/v1/me") {
      await route.fulfill({ json: { isAdmin: false } });
      return;
    }
    if (
      kind === "revisionJobs" &&
      url.pathname === `/app/api/v1/projects/${projectId}`
    ) {
      cursors.push(null);
      await route.fulfill({ json: pageData(kind, false) });
      return;
    }
    const expectedApi =
      kind === "jobs"
        ? "/app/api/v1/jobs"
        : kind === "projects"
          ? "/app/api/v1/projects"
          : kind === "revisionJobs"
            ? `/app/api/v1/projects/${projectId}/revisions/revision_1/jobs`
            : `/app/api/v1/projects/${projectId}`;
    if (url.pathname === expectedApi) {
      const cursor = url.searchParams.get("cursor");
      cursors.push(cursor);
      if (cursor === "next" && cursors.length === 2) {
        await route.fulfill({
          status: 503,
          json: { error: { message: "Temporary failure" } },
        });
      } else {
        if (cursor === "next") await secondGate;
        await route.fulfill({ json: pageData(kind, cursor === "next") });
      }
      return;
    }
    errors.push(`unexpected path: ${url.pathname}`);
    await route.abort();
  });
  await page.goto(`${origin}${pageFor(kind)}`);
  return { page, errors, cursors, releaseSecond };
}

describe("App pagination retry in a real browser", () => {
  it.each(["jobs", "projects", "revisions", "revisionJobs"] as const)(
    "keeps %s history and pagination usable on phone and tablet",
    async (kind) => {
      const { page, errors, releaseSecond } = await fixture(kind);
      try {
        const next = page.locator(nextButtonFor(kind));
        await next.waitFor();
        for (const width of [320, 768, 1024, 1440]) {
          await page.setViewportSize({ width, height: 800 });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          const box = await next.boundingBox();
          if (box === null)
            throw new Error("Pagination button has no visible bounds");
          expect(box.height).toBeGreaterThanOrEqual(44);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
        expect(errors).toEqual([]);
      } finally {
        releaseSecond();
      }
    },
  );

  it.each(["jobs", "projects", "revisions", "revisionJobs"] as const)(
    "retries the same cursor after a transient %s failure without double submission",
    async (kind) => {
      const { page, errors, cursors, releaseSecond } = await fixture(kind);
      const selector = nextButtonFor(kind);
      try {
        const button = page.locator(selector);
        await button.waitFor();
        await button.click();
        await vi.waitFor(async () =>
          expect(await button.isEnabled()).toBe(true),
        );
        expect(await page.locator("#app-error").textContent()).toContain(
          "Temporary failure",
        );
        expect(cursors).toEqual([null, "next"]);
        await button.click();
        await vi.waitFor(() => expect(cursors).toHaveLength(3));
        expect(await button.isEnabled()).toBe(false);
        await page.evaluate((target) => {
          const element = document.querySelector<HTMLButtonElement>(target);
          element?.onclick?.(new PointerEvent("click"));
        }, selector);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(cursors).toEqual([null, "next", "next"]);
        releaseSecond();
        await button.waitFor({ state: "detached" });
        const content = await page.locator("main").textContent();
        expect(content).toContain("First");
        if (kind === "revisionJobs") {
          expect(await page.locator('a[href^="/app/jobs/"]').count()).toBe(2);
          expect(content).not.toContain("詳細APIのcursor");
        } else expect(content).toContain("Second");
        expect(errors).toEqual([]);
      } finally {
        releaseSecond();
      }
    },
  );
});
