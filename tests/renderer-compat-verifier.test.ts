import { describe, expect, it } from "vitest";
import { verifyRendererCompat } from "../deploy/scripts/verify-renderer-compat.mjs";

const manifest = { schemaVersion: 1, objects: [{}, {}] };

function logFor(compile: string, objects: string): string {
  return [
    "LR-COMPAT-REF-compile=UNRESOLVED",
    `LR-COMPAT-REF-compile=${compile}`,
    "LR-COMPAT-REF-objects=UNRESOLVED",
    `LR-COMPAT-REF-objects=${objects}`,
  ].join("\n");
}

describe("real TeX compatibility smoke verifier", () => {
  it("accepts actual TeX \\meaning output with different PDF/SVG pages", () => {
    expect(() =>
      verifyRendererCompat(
        logFor(
          "macro:->{1}{1}{}{equation.1}{}",
          "macro:->{1}{2}{}{equation.1}{}",
        ),
        manifest,
      ),
    ).not.toThrow();
  });

  it("rejects missing passes and a mismatched reference", () => {
    expect(() =>
      verifyRendererCompat("LR-COMPAT-REF-compile=macro:->{1}{1}", manifest),
    ).toThrow(/multiple passes/);
    expect(() =>
      verifyRendererCompat(
        logFor("macro:->{1}{1}", "macro:->{2}{1}"),
        manifest,
      ),
    ).toThrow(/PDF\/SVG reference mismatch/);
  });

  it("rejects missing SVG objects", () => {
    expect(() =>
      verifyRendererCompat(logFor("macro:->{1}{1}", "macro:->{1}{1}"), {
        schemaVersion: 1,
        objects: [{}],
      }),
    ).toThrow(/SVG capture/);
  });
});
