import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererClient } from "../packages/api-client/src/index.js";
import gatewayApp from "../apps/gateway-worker/src/index.js";
afterEach(() => vi.unstubAllGlobals());
describe("client and gateway renewal contract", () => {
  it("accepts the real client's bodyless job-ticket renewal request", async () => {
    const internalFetch = vi.fn(() =>
      Promise.resolve(
        Response.json({
          jobTicket: "renewed-ticket",
          expiresAt: "2026-09-07T00:00:00.000Z",
        }),
      ),
    );
    vi.stubGlobal("fetch", (input: URL, init: RequestInit) => {
      expect(init.body).toBeUndefined();
      expect(new Headers(init.headers).has("Content-Type")).toBe(false);
      return gatewayApp.request(new Request(input, init), undefined, {
        INTERNAL_API: { fetch: internalFetch },
      });
    });
    const client = new RendererClient(
      "https://gateway.example",
      `lrk_${"1".repeat(32)}_${"1".repeat(43)}`,
    );
    await expect(
      client.renewJobTicket(`job_${"b".repeat(32)}`),
    ).resolves.toMatchObject({ jobTicket: "renewed-ticket" });
    expect(internalFetch).toHaveBeenCalledOnce();
  });
});
