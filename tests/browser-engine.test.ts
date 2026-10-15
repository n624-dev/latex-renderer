import { expect, it } from "vitest";
import { browserSettings } from "./helpers/browser-engine.js";

it("defaults to desktop Chromium without a silent cross-engine fallback", () => {
  expect(browserSettings({})).toEqual({ engine: "chromium", hasTouch: false });
  expect(
    browserSettings({ TEST_BROWSER: "webkit", TEST_BROWSER_TOUCH: "1" }),
  ).toEqual({ engine: "webkit", hasTouch: true });
});

it.each([
  { TEST_BROWSER: "typo" },
  { TEST_BROWSER: "" },
  { TEST_BROWSER_TOUCH: "true" },
  { TEST_BROWSER_TOUCH: "" },
])("rejects invalid browser settings before launching (%j)", (environment) => {
  expect(() => browserSettings(environment)).toThrow(/TEST_BROWSER/);
});
