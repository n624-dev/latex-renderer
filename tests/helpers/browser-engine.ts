import {
  chromium,
  webkit,
  type Browser,
  type BrowserContextOptions,
} from "playwright";

export function browserSettings(environment = process.env): {
  engine: "chromium" | "webkit";
  hasTouch: boolean;
} {
  const engine = environment.TEST_BROWSER ?? "chromium";
  if (engine !== "chromium" && engine !== "webkit")
    throw new Error("TEST_BROWSER must be chromium or webkit");
  const touch = environment.TEST_BROWSER_TOUCH ?? "0";
  if (touch !== "0" && touch !== "1")
    throw new Error("TEST_BROWSER_TOUCH must be 0 or 1");
  return { engine, hasTouch: touch === "1" };
}

export function launchTestBrowser(): Promise<Browser> {
  return { chromium, webkit }[browserSettings().engine].launch();
}

export function newTestPage(
  browser: Browser,
  options: BrowserContextOptions = {},
) {
  return browser.newPage({ hasTouch: browserSettings().hasTouch, ...options });
}
