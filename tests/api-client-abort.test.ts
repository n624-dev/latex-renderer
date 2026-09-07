import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { RendererClient } from "../packages/api-client/src/index.js";

afterEach(() => vi.unstubAllGlobals());
const result = {
  id: "job_test", status: "succeeded", sourceSize: 1, sourceSha256: "0".repeat(64),
  createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  errorCode: null, errorMessage: null, artifacts: [], previews: [],
};

describe("HTTP status and renewal cancellation", () => {
  for (const legacy of [false, true]) {
    it(`forwards a status signal without confusing the ${legacy ? "legacy" : "current"} overload`, async () => {
      let requestedUrl: URL | undefined, requestedSignal: AbortSignal | null | undefined;
      vi.stubGlobal("fetch", (url: URL, init?: RequestInit) => {
        requestedUrl = url;
        requestedSignal = init?.signal;
        assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer ticket");
        return Promise.resolve(Response.json(result));
      });
      const client = new RendererClient("https://example.test", "test-api-key"), controller = new AbortController();
      if (legacy) await client.job("https://example.test", "job_test", "ticket", { signal: controller.signal });
      else await client.job("job_test", "ticket", { signal: controller.signal });
      assert.equal(requestedUrl?.pathname, legacy ? "/v1/jobs/job_test" : "/api/v1/jobs/job_test");
      assert.equal(requestedSignal, controller.signal);
    });
  }

  it("forwards the renewal signal", async () => {
    let requestedSignal: AbortSignal | null | undefined;
    vi.stubGlobal("fetch", (_url: URL, init?: RequestInit) => {
      requestedSignal = init?.signal;
      return Promise.resolve(Response.json({ jobTicket: "renewed", expiresAt: "2026-01-01T00:00:00.000Z" }));
    });
    const controller = new AbortController(), client = new RendererClient("https://example.test", "test-api-key");
    await client.renewJobTicket("job_test", { signal: controller.signal });
    assert.equal(requestedSignal, controller.signal);
  });

  it("cancels the in-flight Fetch rather than only abandoning the polling promise", async () => {
    vi.stubGlobal("fetch", (_url: URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("request aborted")), { once: true });
    }));
    const controller = new AbortController(), client = new RendererClient("https://example.test", "test-api-key");
    const pending = client.job("job_test", "ticket", { signal: controller.signal });
    controller.abort();
    await assert.rejects(pending, /request aborted/);
  });
});
