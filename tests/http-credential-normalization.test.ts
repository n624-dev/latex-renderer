import { describe, expect, it } from "vitest";
import {
  AppError,
  exactHttpsOrigin,
  parseBearer,
} from "../packages/shared/src/index.js";

describe("HTTP Bearer grammar", () => {
  it.each([
    "Bearer Token._~+/-==",
    "bearer Token._~+/-==",
    "BEARER   Token._~+/-==",
    " \tBeArEr Token._~+/-==\t ",
  ])("accepts a valid field: %j", (header) => {
    expect(parseBearer(header)).toBe("Token._~+/-==");
  });
  it.each([
    undefined,
    "",
    "Basic abc",
    "Bearer",
    "Bearer ",
    "Bearer\ttoken",
    "Bearer token extra",
    "Bearer to=ken",
    "Bearer token,other",
    'Bearer "token"',
    "Bearer töken",
    "Bearer token\n",
    "Bearer token\r\nX: other",
    "Bearer token\u0000",
    "Bearer\u00a0token",
  ])("rejects malformed/ambiguous credentials: %j", (header) => {
    expect(() => parseBearer(header)).toThrow(AppError);
    try {
      parseBearer(header);
    } catch (error) {
      expect(error).toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    }
  });
  it("does not alter the token's case", () => {
    expect(parseBearer("bearer AbC_123")).toBe("AbC_123");
  });
});

describe("canonical HTTPS origin", () => {
  it.each([
    "https://latex.example",
    "https://latex.example/",
    "https://LATEX.example:443/",
  ])("normalizes a root origin: %s", (input) => {
    expect(exactHttpsOrigin(input)).toBe("https://latex.example");
  });
  it.each([
    "http://latex.example",
    "https://latex.example/mcp",
    "https://latex.example//",
    "https://user:pass@latex.example/",
    "https://latex.example/?query",
    "https://latex.example/#fragment",
    "not a URL",
  ])("rejects a non-origin: %s", (input) => {
    expect(() => exactHttpsOrigin(input)).toThrow();
  });
});
