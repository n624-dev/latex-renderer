import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it, vi } from "vitest";
import { ImageManagerClient } from "../apps/admin-api/src/services/image-manager.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["127.0.0.1", "localhost", "[::1]"])(
  "uses the validated %s loopback endpoint",
  async (host) => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", (url: URL) => {
      requests.push(url.toString());
      return Promise.resolve(Response.json({ current: null }));
    });
    const client = new ImageManagerClient(
      `http://${host}:3110`,
      "fixture-token".repeat(3),
    );
    await client.state();
    expect(requests).toEqual([`http://${host}:3110/v1/state`]);
  },
);

it.each([
  "https://127.0.0.1:3110",
  "http://0.0.0.0:3110",
  "http://[::]:3110",
  "http://example.test:3110",
  "http://localhost.example.test:3110",
  "http://user:password@localhost:3110",
])("keeps non-loopback/credentialed endpoints rejected: %s", (url) => {
  expect(() => new ImageManagerClient(url, "fixture-token".repeat(3))).toThrow(
    "unauthenticated loopback HTTP",
  );
});

it.each(["127.0.0.1", "localhost", "::1"])(
  "parses the actual Manager request URL expression for %s without starting a service",
  (host) => {
    const source = readFileSync("deploy/scripts/image-manager.mjs", "utf8");
    const expressions = [...source.matchAll(/const url = ([\s\S]*?);/g)];
    expect(expressions).toHaveLength(1);
    const expression = expressions[0]?.[1];
    if (!expression) throw new Error("Missing Manager URL construction");
    const url: unknown = runInNewContext(expression, {
      req: { url: "/v1/state?test=1" },
      host,
      port: 3110,
      URL,
    });
    if (!(url instanceof URL)) throw new Error("Expected a parsed Manager URL");
    expect(url.hostname).toBe(host === "::1" ? "[::1]" : host);
    expect(url.pathname).toBe("/v1/state");
    expect(url.searchParams.get("test")).toBe("1");
  },
);
