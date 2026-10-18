import { describe, expect, it } from "vitest";
import { styles } from "../apps/admin-web/src/assets/styles.js";
import { setupCss } from "../packages/setup-web/src/assets.js";
import { setupStyle } from "../deploy/scripts/server-setup-assets.mjs";

const stylesheets: [string, string][] = [
  ["public, login, user and admin pages", styles],
  ["client setup", setupCss],
  ["server setup", setupStyle],
];

describe.each(stylesheets)("neutral theme: %s", (_name, css) => {
  it("keeps every literal color achromatic, including translucent surfaces", () => {
    const hex = [...css.matchAll(/#([\da-f]{6}|[\da-f]{3})\b/gi)];
    expect(hex.length).toBeGreaterThan(10);
    for (const match of hex) {
      const value = match[1];
      if (value === undefined) throw new Error("Missing CSS color");
      const full = value.length === 3 ? value.replace(/./g, "$&$&") : value;
      expect(full.slice(0, 2), `neutral #${value}`).toBe(full.slice(2, 4));
      expect(full.slice(2, 4), `neutral #${value}`).toBe(full.slice(4, 6));
    }
    for (const [, red, green, blue] of css.matchAll(
      /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/g,
    )) {
      expect(Number(red)).toBe(Number(green));
      expect(Number(green)).toBe(Number(blue));
    }
    expect(css).not.toMatch(/\b(?:hsla?|oklch|oklab|lab|lch|hwb)\(/i);
    expect(css).not.toMatch(/:\s*(?:blue|red|green|navy|teal|purple)\b/i);
  });

  it("supports the system theme without desaturating rendered documents", () => {
    expect(css).toMatch(/prefers-color-scheme:\s*dark/);
    expect(css).toContain("::selection");
    expect(css).toContain(":focus-visible");
    expect(css).not.toMatch(/(?:grayscale|saturate|hue-rotate)\(/);
  });
});

it("distinguishes neutral statuses and destructive actions without hue", () => {
  expect(styles).toContain("border-left-style: dashed");
  expect(styles).toContain("border-left-style: double");
  expect(styles).toContain("border: 3px double var(--danger-text)");
  expect(styles).toMatch(/\.status\.failed::before[^}]*border-radius: 0/);
  expect(styles).toMatch(/\.status\.queued::before[^}]*rotate\(45deg\)/);
  expect(styles).toMatch(
    /\.status\.running::before[^}]*background: transparent/,
  );
  expect(setupCss).toContain(".notice.error { border-left-style:double");
});
