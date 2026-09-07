import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { appScript } from "../apps/admin-web/src/assets/app-script.js";

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
function harness(elements: Map<string, Element>, pathname = "/app/render/") {
  const context = {
    Headers,
    URLSearchParams,
    URL,
    setTimeout,
    crypto,
    CSS: { escape: (value: string) => value },
    document: {
      querySelector: (selector: string) => elements.get(selector) ?? null,
      createElement: () => new Element(),
    },
    location: { pathname, assign: vi.fn() },
    hooks: undefined as unknown as {
      installRender(fetcher: Fetcher): void;
      installProjects(fetcher: Fetcher): void;
      renderJobResult(...args: unknown[]): void;
    },
  };
  const end = appScript.lastIndexOf("  (function installApp(");
  expect(end).toBeGreaterThan(0);
  runInNewContext(
    appScript.slice(0, end) +
      'csrfToken = "test-csrf"; globalThis.hooks = {installRender, installProjects, renderJobResult};})();',
    context,
  );
  return context.hooks;
}

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
    harness(
      new Map([["#app-project-detail", detail]]),
      `/app/projects/project_${"a".repeat(32)}/`,
    ).installProjects((_input, init) => {
      if (init?.method === "POST") {
        if (typeof init.body !== "string") throw new Error("Expected JSON body");
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
    harness(selectors).installRender((input) => {
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
    harness(
      elements,
      `/app/projects/project_${"a".repeat(32)}/`,
    ).installProjects(() => {
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
    });
    await vi.waitFor(() => expect(next.onclick).toBeTypeOf("function"));
    const click = next.onclick;
    if (!click) throw new Error("Missing pagination handler");
    click();
    await vi.waitFor(() => expect(detail.innerHTML).toContain("Revision 2"));
    expect(detail.innerHTML).not.toContain('id="app-revisions-next"');
    click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(requests).toBe(2);
  });

  it("uses the actual padded preview path in the result button", () => {
    const container = new Element();
    harness(new Map()).renderJobResult(
      container,
      () => {},
      {},
      {
        id: "job_test",
        status: "succeeded",
        artifacts: [],
        previews: [{ relativePath: "previews/page-01.png", type: "preview" }],
      },
      "Result",
    );
    expect(
      container.children[0]?.children[2]?.children.map(
        (item) => item.textContent,
      ),
    ).toContain("プレビュー");
  });
});
