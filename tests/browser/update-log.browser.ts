import type { Browser } from "playwright";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { updateViewSource } from "../helpers/admin-ui-source.js";
import { localizedAdminScript } from "../../apps/admin-web/src/assets/admin-script.js";
import { styles } from "../../apps/admin-web/src/assets/styles.js";
import { readBrowserAsset } from "../../apps/admin-web/src/browser-assets.js";
import { adminPage } from "../../apps/admin-web/src/templates-admin.js";
import {
  adminCatalog,
  createAdminMessage,
} from "../../apps/admin-web/src/admin-messages.js";

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser?.close();
});

it("shows rejected policy writes and reloads the confirmed policy and accepted operation ID", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser);
  const origin = "https://renderer.invalid";
  const id = "updop_1700000000000_fixture";
  const errors = [
    {
      status: 409,
      code: "UPDATE_OPERATION_ACTIVE",
      message: "Update policy cannot change while an operation is running",
    },
    { status: 500, code: "ENOENT", message: "Update state rename failed" },
  ];
  let policyRequests = 0,
    applyRequests = 0,
    restarted = false;
  const script = localizedAdminScript("en");
  try {
    await page.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      switch (url.pathname) {
        case "/admin/updates/":
          return route.fulfill({
            contentType: "text/html",
            body: adminPage("updates", "en"),
          });
        case "/admin/assets/styles.css":
          return route.fulfill({ contentType: "text/css", body: styles });
        case "/admin/assets/site.js":
          return route.fulfill({
            contentType: "text/javascript",
            body: readBrowserAsset("site"),
          });
        case "/admin/assets/admin.js":
          return route.fulfill({
            contentType: "text/javascript",
            body: script,
          });
        case "/auth/session":
          return route.fulfill({ json: { csrfToken: "fixture-csrf" } });
        case "/admin/api/v1/me":
          return route.fulfill({
            json: { role: "owner", displayLocale: "en" },
          });
        case "/admin/api/v1/updates/state":
          return route.fulfill({
            json: {
              policy: { channel: "stable", mode: "automatic" },
              lastOperationId: restarted ? id : null,
            },
          });
        case "/admin/api/v1/updates/policy": {
          const failure = errors[policyRequests++];
          if (!failure) throw new Error("Unexpected extra policy mutation");
          const { status, code, message } = failure;
          return route.fulfill({ status, json: { error: { code, message } } });
        }
        case "/admin/api/v1/updates/apply":
          applyRequests++;
          return route.fulfill({
            status: 202,
            json: { id, status: "running" },
          });
        case `/admin/api/v1/updates/operations/${id}`:
          return route.fulfill({
            json: { id, status: restarted ? "failed" : "running" },
          });
        default:
          return route.fulfill({ status: 404, body: "" });
      }
    });
    await page.goto(`${origin}/admin/updates/?locale=en`);
    const policy = page.locator("#update-policy-form");
    const mode = policy.locator('select[name="mode"]');
    await mode.waitFor();
    expect(await mode.inputValue()).toBe("automatic");
    for (const { code, message } of errors) {
      await mode.selectOption("notify");
      await policy.locator("textarea").fill("Confirm fixture policy");
      await policy.locator("button").click();
      await page.getByText(`[${code}] ${message}`, { exact: true }).waitFor();
      expect(await page.locator("#success").textContent()).toBe("");
    }
    await page.locator("#update-apply").click();
    await page.locator("dialog textarea").fill("Fixture deployment");
    await page.locator('dialog button[type="submit"]').click();
    const operation = page.locator(
      `#update-operation [data-operation-id="${id}"]`,
    );
    await operation.waitFor();
    restarted = true;
    await page.reload();
    await operation.waitFor();
    expect(await mode.inputValue()).toBe("automatic");
    expect(await page.locator("#error").textContent()).toBe("");
    expect([policyRequests, applyRequests]).toEqual([2, 1]);
  } finally {
    await page.close();
  }
});

it("preserves update log disclosure, focus, and scroll across polling and page refresh", async () => {
  if (!browser) throw new Error("Browser not started");
  const page = await newTestPage(browser);
  try {
    await page.setContent(
      `<!doctype html><html lang="ja"><style>${styles}</style><main><div id="update-operation"></div></main></html>`,
    );
    await page.addScriptTag({
      content: `const adminMessage=(${createAdminMessage.toString()})(${JSON.stringify(adminCatalog("ja"))});\n${updateViewSource}\nwindow.updateLogTest={render:renderUpdateOperation,remember:rememberUpdateLogView};`,
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
