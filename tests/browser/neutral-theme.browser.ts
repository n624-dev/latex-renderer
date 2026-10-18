import { execFileSync } from "node:child_process";
import type { Browser } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchTestBrowser, newTestPage } from "../helpers/browser-engine.js";
import { setupCss } from "../../packages/setup-web/src/assets.js";
import { setupStyle } from "../../deploy/scripts/server-setup-assets.mjs";

// The WebKit job builds the Web application, not the client distribution.
// Setup CSS is a static string: import it directly without adding unrelated
// package builds to that job. The public stylesheet comes from the actual build.
const css = [
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      "const module=await import(process.argv[1]);process.stdout.write(module.styles);",
      new URL("../../apps/admin-web/dist/assets/styles.js", import.meta.url)
        .href,
    ],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 256 * 1024 },
  ),
  setupCss,
  setupStyle,
];

let browser: Browser | undefined;
beforeAll(async () => {
  browser = await launchTestBrowser();
});
afterAll(async () => {
  await browser?.close();
});

const themes = [
  { name: "system light", system: "light", expected: "light" },
  { name: "system dark", system: "dark", expected: "dark" },
  {
    name: "explicit light over dark system",
    system: "dark",
    explicit: "light",
    expected: "light",
  },
  {
    name: "explicit dark over light system",
    system: "light",
    explicit: "dark",
    expected: "dark",
  },
] as const;

describe.each([0, 1, 2])("shipped neutral stylesheet %i", (kind) => {
  const stylesheet = css[kind];
  if (!stylesheet) throw new Error("Stylesheet not found");
  const supportedThemes = kind === 0 ? themes : themes.slice(0, 2);
  for (const theme of supportedThemes) {
    it.each([390, 1280])(
      `${theme.name} at %ipx keeps neutral controls and contrast`,
      async (width) => {
        if (!browser) throw new Error("Browser not started");
        const page = await newTestPage(browser, {
          viewport: { width, height: 900 },
        });
        try {
          await page.emulateMedia({ colorScheme: theme.system });
          await page.setContent(`<!doctype html><html lang="ja"><head><style>${stylesheet}</style></head><body><main>
          <h1>レンダリング</h1><section><h2>文書と設定</h2>
          <p class="muted">日本語とEnglish。状態は文字でも確認できます。</p>
          <label>文書名<input value="日本語文書"></label>
          <label>実行先<select><option>標準</option></select></label>
          <label><input type="checkbox" checked>SVGを生成</label>
          <div class="actions"><button id="primary">開始</button><button class="secondary quiet">戻る</button><button class="danger">削除</button></div>
          <p class="notice success">完了しました</p><p class="notice warning">警告：内容を確認</p><p class="notice error">エラー：文書がありません</p>
          <p class="error-summary">変換失敗</p><p><span class="status succeeded">成功</span> <span class="status failed">失敗</span> <span class="status queued">待機中</span></p>
          <pre>診断結果</pre></section></main></body></html>`);
          if ("explicit" in theme)
            await page.evaluate((value) => {
              document.documentElement.dataset.theme = value;
            }, theme.explicit);
          const result = await page.evaluate(() => {
            const channels = (color: string) => {
              const values = color.match(/[\d.]+/g)?.map(Number);
              const [red, green, blue, alpha] = values ?? [];
              if (
                red === undefined ||
                green === undefined ||
                blue === undefined
              )
                throw new Error(`Unsupported color: ${color}`);
              return [red, green, blue, alpha ?? 1] as const;
            };
            const luminance = (color: string) => {
              const linear = (value: number) => {
                const c = value / 255;
                return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
              };
              const [red, green, blue] = channels(color);
              return (
                0.2126 * linear(red) +
                0.7152 * linear(green) +
                0.0722 * linear(blue)
              );
            };
            const contrast = (a: string, b: string) => {
              const x = luminance(a),
                y = luminance(b);
              return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
            };
            const colors: string[] = [];
            for (const element of [
              document.documentElement,
              document.body,
              ...document.querySelectorAll("main, main *"),
            ]) {
              for (const pseudo of [null, "::before", "::after"]) {
                const style = getComputedStyle(element, pseudo);
                for (const property of [
                  "color",
                  "background-color",
                  "border-top-color",
                  "border-left-color",
                  "outline-color",
                  "accent-color",
                ]) {
                  const color = style.getPropertyValue(property);
                  if (color && color !== "auto" && color !== "transparent")
                    colors.push(color);
                }
              }
            }
            const tinted = colors.filter((color) => {
              const [r, g, b, a] = channels(color);
              return a !== 0 && (r !== g || g !== b);
            });
            const sectionElement = document.querySelector("section"),
              mutedElement = document.querySelector(".muted"),
              primary = document.querySelector<HTMLButtonElement>("#primary");
            if (!sectionElement || !mutedElement || !primary)
              throw new Error("Theme fixture is incomplete");
            const body = getComputedStyle(document.body),
              section = getComputedStyle(sectionElement),
              muted = getComputedStyle(mutedElement);
            const buttons = [...document.querySelectorAll("button")].map(
              (button) => {
                const s = getComputedStyle(button);
                return {
                  contrast: contrast(s.color, s.backgroundColor),
                  height: button.getBoundingClientRect().height,
                };
              },
            );
            primary.focus();
            const focus = getComputedStyle(primary);
            return {
              tinted,
              background: body.backgroundColor,
              textContrast: contrast(body.color, body.backgroundColor),
              mutedContrast: contrast(muted.color, section.backgroundColor),
              buttons,
              focusWidth: focus.outlineWidth,
              focusContrast: contrast(
                focus.outlineColor,
                section.backgroundColor,
              ),
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          expect(result.tinted).toEqual([]);
          expect(result.background).toBe(
            theme.expected === "light"
              ? "rgb(245, 245, 245)"
              : "rgb(17, 17, 17)",
          );
          expect(result.textContrast).toBeGreaterThanOrEqual(7);
          expect(result.mutedContrast).toBeGreaterThanOrEqual(4.5);
          for (const button of result.buttons) {
            expect(button.contrast).toBeGreaterThanOrEqual(4.5);
            expect(button.height).toBeGreaterThanOrEqual(44);
          }
          expect(result.focusWidth).toBe("3px");
          expect(result.focusContrast).toBeGreaterThanOrEqual(3);
          expect(result.overflow).toBe(false);
        } finally {
          await page.close();
        }
      },
    );
  }
});
