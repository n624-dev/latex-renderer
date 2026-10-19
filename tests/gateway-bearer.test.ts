import { describe, expect, it } from "vitest";
import { proxyGatewayJson } from "../packages/gateway-core/src/index.js";

const token = `lrk_${"a".repeat(32)}_${"A".repeat(43)}`;
describe("public Gateway Bearer scheme", () => {
  it.each(["Bearer ", "bearer ", "BEARER ", "bEaReR    "])(
    "preserves a valid token with scheme %j",
    async (scheme) => {
      const forwarded: string[] = [];
      const response = await proxyGatewayJson({
        request: new Request("https://gateway.example/api/v1/projects", {
          headers: { Authorization: scheme + token },
        }),
        upstreamPath: "/internal/v1/projects",
        requestId: "fixture",
        bodyRequired: false,
        fetchUpstream: (_url, init) => {
          forwarded.push(new Headers(init.headers).get("Authorization")!);
          return Promise.resolve(Response.json({ items: [] }));
        },
      });
      expect(response.status).toBe(200);
      expect(forwarded).toEqual([scheme + token]);
    },
  );
  it.each([
    `Bearer\t${token}`,
    `Basic ${token}`,
    `Bearer ${token},other`,
    `Bearer ${token.toUpperCase()}`,
    `Bearer ${token.slice(0, -1)}`,
  ])(
    "rejects malformed authorization %j before upstream",
    async (authorization) => {
      let called = false;
      const response = await proxyGatewayJson({
        request: new Request("https://gateway.example/api/v1/projects", {
          headers: { Authorization: authorization },
        }),
        upstreamPath: "/internal/v1/projects",
        requestId: "fixture",
        bodyRequired: false,
        fetchUpstream: () => {
          called = true;
          return Promise.resolve(Response.json({}));
        },
      });
      expect(response.status).toBe(401);
      expect(called).toBe(false);
    },
  );
});
