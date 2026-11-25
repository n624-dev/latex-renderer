import { readdir, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  displayLocales,
  matchDisplayLocale,
  preferredDisplayLanguages,
  resolveDisplayLocale,
} from "../packages/shared/src/locale.js";
import {
  english,
  type EditorCatalog,
} from "../apps/admin-web/src/editor/messages.js";
import japanese from "../apps/admin-web/src/editor/locales/ja.js";
import { setupTexts } from "../deploy/scripts/setup-messages.mjs";

const parameters = (value: string) => value.match(/\{\w+\}/g)?.sort() ?? [];

describe("display locale", () => {
  it("provides all 18 editor catalogs with matching message parameters and CodeMirror phrases", async () => {
    const root = new URL(
      "../apps/admin-web/src/editor/locales/",
      import.meta.url,
    );
    const locales = displayLocales.filter((name) => name !== "en");
    expect((await readdir(root)).sort()).toEqual(
      locales.map((name) => `${name}.ts`).sort(),
    );
    for (const name of locales) {
      const resource = new URL(`${name}.ts`, root).href;
      const { default: catalog } = (await import(resource)) as {
        default: EditorCatalog;
      };
      expect(Object.keys(catalog.messages).sort(), name).toEqual(
        Object.keys(english).sort(),
      );
      for (const [key, expected] of Object.entries(english)) {
        const message = catalog.messages[key as keyof typeof english];
        expect(message.trim(), `${name}/${key}`).not.toBe("");
        expect(parameters(message), `${name}/${key}`).toEqual(
          parameters(expected),
        );
      }
      expect(Object.keys(catalog.phrases).sort(), name).toEqual(
        Object.keys(japanese.phrases).sort(),
      );
      for (const parameter of [
        "replaced $ matches",
        "replaced match on line $",
      ])
        expect(catalog.phrases[parameter], `${name}/${parameter}`).toContain(
          "$",
        );
    }
  });

  it("matches the setup catalog keys and message parameters in all 18 languages", async () => {
    const root = new URL("../deploy/scripts/setup-locales/", import.meta.url);
    const setupEnglish = setupTexts("en");
    for (const locale of displayLocales) {
      if (locale === "en") continue;
      const file = await readFile(new URL(`${locale}.json`, root), "utf8");
      const messages = JSON.parse(file) as Record<string, string>;
      expect(Object.keys(messages).sort(), locale).toEqual(
        Object.keys(setupEnglish).sort(),
      );
      for (const [key, value] of Object.entries(setupEnglish)) {
        expect(messages[key]?.trim(), `${locale}/${key}`).toBeTruthy();
        expect(parameters(messages[key] ?? ""), `${locale}/${key}`).toEqual(
          parameters(value),
        );
      }
    }
  });

  it("resolves all initial catalogs and has Intl formatting and plural data for each", () => {
    expect(new Set(displayLocales).size).toBe(18);
    for (const locale of displayLocales)
      expect(matchDisplayLocale(locale)).toBe(locale);
    expect(Intl.DateTimeFormat.supportedLocalesOf(displayLocales)).toHaveLength(
      18,
    );
    expect(Intl.NumberFormat.supportedLocalesOf(displayLocales)).toHaveLength(
      18,
    );
    expect(Intl.PluralRules.supportedLocalesOf(displayLocales)).toHaveLength(
      18,
    );
  });

  it("gives the explicit selection priority over saved and device preferences", () => {
    expect(
      resolveDisplayLocale({ selected: "ja", saved: "de", preferred: ["fr"] }),
    ).toBe("ja");
    expect(resolveDisplayLocale({ saved: "de", preferred: ["fr"] })).toBe("de");
    expect(resolveDisplayLocale({ preferred: ["fr-CA", "de"] })).toBe("fr");
  });

  it("skips invalid and unsupported tags before falling back to English", () => {
    expect(
      resolveDisplayLocale({ selected: "!", preferred: ["ar", "ko-KR"] }),
    ).toBe("ko");
    expect(resolveDisplayLocale({ preferred: ["ar", "zh-TW"] })).toBe("en");
    expect(resolveDisplayLocale({})).toBe("en");
  });

  it("matches Simplified Chinese and Bokmål without substituting a distinct script or language", () => {
    expect(matchDisplayLocale("zh-Hans-SG")).toBe("zh-CN");
    expect(matchDisplayLocale("zh")).toBe("zh-CN");
    expect(matchDisplayLocale("zh-Hant-CN")).toBeUndefined();
    expect(matchDisplayLocale("nb-NO")).toBe("no");
    expect(matchDisplayLocale("nn-NO")).toBeUndefined();
  });

  it("honors accepted language weights and rejects malformed or disabled preferences", () => {
    expect(
      preferredDisplayLanguages(
        "ja;q=0.5, fr-CA, de;q=0.5, ko;q=0, xx;q=bogus, *;q=0.3",
      ),
    ).toEqual(["fr-CA", "ja", "de"]);
  });

  it("accepts whitespace around a single quality parameter and ignores extra parameters", () => {
    expect(
      preferredDisplayLanguages("ja \t ; \t q=0.5, de;q=1;ignored, en"),
    ).toEqual(["en", "ja"]);
  });
});
