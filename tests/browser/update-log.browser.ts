import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { part7 } from "../../apps/admin-web/src/assets/admin-script-parts/part-7.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser?.close();
});

it("preserves update log disclosure, focus, and scroll across polling and page refresh", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser);
  try {
    await page.setContent(
      `<!doctype html><html lang="ja"><style>${styles}</style><main><div id="update-operation"></div></main></html>`,
    );
    await page.addScriptTag({
      content: `${part7}\nwindow.updateLogTest={render:renderUpdateOperation,remember:rememberUpdateLogView};`,
    });
    const result = await page.evaluate(() => {
      const controls = (
        window as typeof window & {
          updateLogTest: {
            render: (operation: {
              id: string;
              status: string;
              log: string;
            }) => void;
            remember: () => void;
          };
        }
      ).updateLogTest;
      // Exercise the shipped string, not an independently reimplemented view.
      const render = (id: string, suffix = "") => {
        controls.render({
          id,
          status: "running",
          log: "line\n".repeat(150) + suffix,
        });
      };
      const details = () => {
        const element = document.querySelector<HTMLDetailsElement>("details");
        if (!element) throw new Error("Missing details");
        return element;
      };
      const log = () => {
        const element = document.querySelector<HTMLPreElement>("pre");
        if (!element) throw new Error("Missing log");
        return element;
      };
      render("op-1");
      const initiallyClosed = !details().open;
      details().open = true;
      const summary = details().querySelector("summary");
      if (!summary) throw new Error("Missing summary");
      summary.focus();
      log().scrollTop = 120;
      render("op-1", "next");
      const retained = {
        open: details().open,
        focus: document.activeElement === summary,
        scroll: log().scrollTop,
        sameNode: details().querySelector("summary") === summary,
      };
      // updates() captures the view immediately before replacing its content.
      controls.remember();
      document.querySelector("#update-operation")?.replaceChildren();
      render("op-1", "refreshed");
      const refreshed = { open: details().open, scroll: log().scrollTop };
      details().open = false;
      render("op-1", "closed");
      const staysClosed = !details().open;
      render("op-2");
      return {
        initiallyClosed,
        retained,
        refreshed,
        staysClosed,
        newOperationClosed: !details().open,
      };
    });
    expect(result).toEqual({
      initiallyClosed: true,
      retained: { open: true, focus: true, scroll: 120, sameNode: true },
      refreshed: { open: true, scroll: 120 },
      staysClosed: true,
      newOperationClosed: true,
    });
  } finally {
    await page.close();
  }
});
