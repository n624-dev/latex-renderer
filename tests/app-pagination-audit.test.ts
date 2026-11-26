import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installApp,
  jobTracker,
  renderJobResult,
} from "../apps/admin-web/src/assets/app-script.js";
import { appBrowserConfig } from "../apps/admin-web/src/assets/localized-app-script.js";

const config = appBrowserConfig("ja");
afterEach(() => vi.unstubAllGlobals());

class Element {
  innerHTML = "";
  textContent = "";
  value = "";
  children: Element[] = [];
  dataset: Record<string, string> = {};
  disabled = false;
  selectors = new Map<string, Element>();
  onclick: (() => void) | undefined;
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren() {
    this.children = [];
  }
  querySelector(selector: string) {
    return this.selectors.get(selector) ?? null;
  }
  querySelectorAll() {
    return this.children;
  }
}
type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
function fixture(elements: Map<string, Element>, pathname = "/app/render/") {
  vi.stubGlobal("CSS", { escape: (value: string) => value });
  vi.stubGlobal("document", {
    documentElement: { lang: "ja" },
    body: { dataset: {} },
    querySelector: (selector: string) => elements.get(selector) ?? null,
    querySelectorAll: () => [],
    createElement: () => new Element(),
  });
  vi.stubGlobal("location", {
    pathname,
    href: `http://localhost${pathname}`,
    assign: vi.fn(),
  });
  return (page: string, fetcher: Fetcher) => {
    document.body.dataset.appPage = page;
    return installApp(config, (input, init) => {
      if (input === "/auth/session")
        return Promise.resolve(Response.json({ csrfToken: "test-csrf" }));
      if (input === "/app/api/v1/me")
        return Promise.resolve(Response.json({ isAdmin: false }));
      return fetcher(input, init);
    });
  };
}

const resultOnly: Fetcher = () => Promise.resolve(Response.json({}));

describe("audit Web pagination and retained previews", () => {
  it("sends the selected rerender outputs and displays per-Job formats", async () => {
    const detail = new Element(),
      button = new Element(),
      select = new Element();
    button.dataset.rerender = "revision_test";
    select.value = "svg";
    detail.children.push(button);
    detail.selectors.set("#outputs-revision_test", select);
    let submitted: unknown;
    await fixture(
      new Map([["#app-project-detail", detail]]),
      `/app/projects/project_${"a".repeat(32)}/`,
    )("projects", (_input, init) => {
      if (init?.method === "POST") {
        if (typeof init.body !== "string")
          throw new Error("Expected JSON body");
        submitted = JSON.parse(init.body);
        return Promise.resolve(Response.json({}));
      }
      return Promise.resolve(
        Response.json({
          displayName: "Project",
          revisionsHasMore: false,
          revisionsNextCursor: null,
          revisions: [
            {
              id: "revision_test",
              revisionNumber: 1,
              displayName: "Original",
              originalFilename: "main.tex",
              createdAt: "2026-01-01",
              jobs: [
                {
                  id: "job_test",
                  status: "succeeded",
                  createdAt: "2026-01-01",
                  outputs: ["pdf", "svg"],
                },
              ],
              jobCount: 1,
            },
          ],
        }),
      );
    });
    await vi.waitFor(() => expect(button.onclick).toBeTypeOf("function"));
    expect(detail.innerHTML).toContain("PDF＋SVG");
    button.onclick?.();
    await vi.waitFor(() =>
      expect(submitted).toEqual({ outputs: ["pdf", "svg"] }),
    );
  });

  it("adds later Project pages to the render selector", async () => {
    const elements = new Map(
      [
        "form",
        "files",
        "svg",
        "start",
        "project-name",
        "project-select",
        "project-name-field",
        "entrypoints",
        "results",
        "items",
        "recent",
      ].map((key) => [key, new Element()]),
    );
    const selectors = new Map<string, Element>();
    for (const [name, key] of Object.entries({
      "app-render-form": "form",
      "app-files": "files",
      "app-render-svg": "svg",
      "app-render-start": "start",
      "app-project-name": "project-name",
      "app-project-select": "project-select",
      "app-project-name-field": "project-name-field",
      "app-entrypoints": "entrypoints",
      "app-render-results": "results",
      "app-render-items": "items",
      "app-recent-jobs": "recent",
    })) {
      const element = elements.get(key);
      if (!element) throw new Error("Missing fixture element");
      selectors.set(`#${name}`, element);
    }
    let requests = 0;
    await fixture(selectors)("render", (input) => {
      const path = input instanceof Request ? input.url : input.toString();
      if (!path.includes("/projects?"))
        return Promise.resolve(Response.json({ items: [], hasMore: false }));
      requests++;
      return Promise.resolve(
        Response.json(
          path.includes("cursor=next")
            ? {
                items: [{ id: "second", displayName: "Second" }],
                hasMore: false,
                nextCursor: null,
              }
            : {
                items: [{ id: "first", displayName: "First" }],
                hasMore: true,
                nextCursor: "next",
              },
        ),
      );
    });
    await vi.waitFor(() =>
      expect(
        elements.get("project-select")?.children.map((item) => item.value),
      ).toEqual(["first", "second"]),
    );
    expect(requests).toBe(2);
  });

  it("hides the next-revision button and rejects stale clicks after the last page", async () => {
    const detail = new Element(),
      next = new Element();
    const elements = new Map([
      ["#app-project-detail", detail],
      ["#app-revisions-next", next],
    ]);
    let requests = 0;
    await fixture(elements, `/app/projects/project_${"a".repeat(32)}/`)(
      "projects",
      () => {
        requests++;
        return Promise.resolve(
          Response.json({
            displayName: "Project",
            revisions: [
              {
                id: String(requests),
                revisionNumber: requests,
                displayName: "Revision",
                originalFilename: "main.tex",
                entrypoint: "main.tex",
                createdAt: "2026-01-01",
                jobs: [],
                jobCount: 0,
                jobsHasMore: false,
              },
            ],
            revisionsHasMore: requests === 1,
            revisionsNextCursor: requests === 1 ? "next" : null,
          }),
        );
      },
    );
    await vi.waitFor(() => expect(next.onclick).toBeTypeOf("function"));
    const click = next.onclick;
    if (!click) throw new Error("Missing pagination handler");
    click();
    await vi.waitFor(() => expect(detail.innerHTML).toContain("改訂 2"));
    expect(detail.innerHTML).not.toContain('id="app-revisions-next"');
    click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toBe(2);
  });

  it("uses the actual padded preview path in the result button", async () => {
    const container = new Element();
    await fixture(new Map())("", resultOnly);
    renderJobResult(
      container as unknown as HTMLElement,
      resultOnly,
      jobTracker(resultOnly, "job_test"),
      {
        id: "job_test",
        status: "succeeded",
        retentionExpiresAt: null,
        errorCode: null,
        errorMessage: null,
        artifacts: [],
        previews: [
          {
            relativePath: "previews/page-01.png",
            type: "preview",
            size: 0,
            sha256: "0".repeat(64),
            createdAt: "2026-01-01",
            downloadUrl: "/api/v1/jobs/job_test/artifacts/previews/page-01.png",
          },
        ],
      },
      "Result",
    );
    expect(
      container.children[0]?.children[2]?.children.map(
        (item) => item.textContent,
      ),
    ).toContain("プレビュー");
  });

  it("shows detailed queued resource waiting in the result", async () => {
    const container = new Element();
    await fixture(new Map())("", resultOnly);
    renderJobResult(
      container as unknown as HTMLElement,
      resultOnly,
      jobTracker(resultOnly, "job_test"),
      {
        id: "job_test",
        status: "queued",
        retentionExpiresAt: null,
        errorCode: "HOST_RESOURCE_WAIT",
        errorMessage: "利用可能: 700MiB、開始条件: 704MiB",
        artifacts: [],
        previews: [],
      },
      "Result",
    );
    expect(container.children[0]?.children[1]?.textContent).toContain("704MiB");
  });
});
