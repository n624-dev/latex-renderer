import { describe, expect, it } from "vitest";
import { URL } from "node:url";
import { renderHomebrewFormula } from "../deploy/homebrew/formula.mjs";

describe("Homebrew client package", () => {
  const checksum = "d".repeat(64);

  it("pins the exact release asset and preserves the public launcher names", () => {
    const formula = renderHomebrewFormula("1.8.0", checksum);
    expect(formula).toContain(
      'url "https://github.com/n624-dev/latex-renderer/releases/download/v1.8.0/latex-renderer-client-1.8.0.zip"',
    );
    expect(formula).toContain(`sha256 "${checksum}"`);
    expect(formula).toContain('depends_on "node@24"');
    expect(formula).toContain("depends_on :macos");
    expect(formula).toContain('libexec.install "app", "skill"');
    expect(formula).toContain('"N624_LATEX_PACKAGE"             => "homebrew"');
    expect(formula).toContain('HOMEBREW_PREFIX/"bin/latex-render"');
    expect(formula).toContain('"n624-latex"');
    expect(formula).toContain('"latex-render-admin"');
    expect(formula).toContain('"latex-renderer-mcp"');
    expect(formula).not.toContain("revision ");
  });

  it("accepts local fixture files and a revision for testing actual upgrades", () => {
    const formula = renderHomebrewFormula("1.8.0-rc.1", checksum, {
      fixture: new URL("file:///tmp/with%20space/client.zip"),
      revision: 1,
    });
    expect(formula).toContain('url "file:///tmp/with%20space/client.zip"');
    expect(formula).toContain('version "1.8.0-rc.1"');
    expect(formula).toContain("revision 1");
  });

  it("rejects invalid fixture URLs, release versions, and digests", () => {
    expect(() =>
      renderHomebrewFormula("1.8.0", checksum, {
        fixture: new URL("https://example.test/download.zip"),
      }),
    ).toThrow("local files");
    expect(() => renderHomebrewFormula("../42", checksum)).toThrow();
    expect(() => renderHomebrewFormula("1.8.0", checksum + "\n")).toThrow(
      "SHA-256",
    );
  });
});
