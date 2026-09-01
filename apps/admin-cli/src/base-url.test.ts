import { describe, expect, it } from "vitest";
import { adminApiBaseUrl } from "./base-url.js";

describe("Admin API credential origin", () => {
  it("uses the configured URL when it has the public origin", () => {
    expect(
      adminApiBaseUrl(
        "https://latex.example.test/internal",
        "https://latex.example.test",
        undefined,
      ).pathname,
    ).toBe("/internal");
  });

  it("requires a separate allowlist for a different origin", () => {
    expect(() =>
      adminApiBaseUrl(
        "https://admin.example.test",
        "https://latex.example.test",
        undefined,
      ),
    ).toThrow(/TRUSTED_ADMIN_ORIGINS/);
    expect(
      adminApiBaseUrl(
        "https://admin.example.test",
        "https://latex.example.test",
        "https://admin.example.test",
      ).origin,
    ).toBe("https://admin.example.test");
  });

  it("rejects plaintext non-loopback origins", () => {
    expect(() =>
      adminApiBaseUrl(
        "http://admin.example.test",
        "https://latex.example.test",
        "http://admin.example.test",
      ),
    ).toThrow(/HTTPS/);
    expect(
      adminApiBaseUrl(
        "http://127.0.0.1:3200",
        "https://latex.example.test",
        "http://127.0.0.1:3200",
      ).origin,
    ).toBe("http://127.0.0.1:3200");
  });
});
