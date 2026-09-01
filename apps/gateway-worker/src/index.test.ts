import { afterEach, describe, expect, it, vi } from "vitest";
import { gatewayRoute } from "@latex-renderer/gateway-core";
import gatewayApp from "./index.js";

afterEach(() => vi.unstubAllGlobals());

describe("gateway boundary", () => {
  it("exposes the routed API health check without contacting the origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await gatewayApp.request("/api/v1/health");
    expect(response.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("uses the private VPC binding and rejects an upstream redirect", async () => {
    const internalFetch = vi.fn(
      (_input: string | URL | Request, init?: RequestInit) => {
        expect(init?.redirect).toBe("manual");
        return new Response(null, {
          status: 302,
          headers: { Location: "https://access.example.test/login" },
        });
      },
    );

    const response = await gatewayApp.request(
      "/v1/render-tickets",
      {
        method: "POST",
        headers: {
          Authorization:
            "Bearer lrk_00000000000000000000000000000000_0000000000000000000000000000000000000000000",
          "Content-Length": "86",
          "Content-Type": "application/json",
          "Idempotency-Key": "gateway-test-key-0001",
        },
        body: JSON.stringify({ size: 1, sha256: "0".repeat(64) }),
      },
      {
        INTERNAL_API: { fetch: internalFetch },
      },
    );

    expect(internalFetch).toHaveBeenCalledOnce();
    const upstream = internalFetch.mock.calls[0]?.[0];
    expect(
      upstream instanceof URL
        ? upstream.href
        : upstream instanceof Request
          ? upstream.url
          : upstream,
    ).toBe("http://internal-api.local/internal/v1/render-tickets");
    const headers = new Headers(internalFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.has("CF-Access-Client-Id")).toBe(false);
    expect(headers.has("CF-Access-Client-Secret")).toBe(false);
    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cloudflare-cdn-cache-control")).toBe(
      "no-store",
    );
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UPSTREAM_REDIRECT_REJECTED" },
    });
  });

  it("proxies Source reservations through the private binding", async () => {
    let upstream = "";
    const response = await gatewayApp.request(
      "/api/v1/source-tickets",
      {
        method: "POST",
        headers: {
          Authorization:
            "Bearer lrk_11111111111111111111111111111111_1111111111111111111111111111111111111111111",
          "Content-Type": "application/json",
          "Content-Length": "86",
          "Idempotency-Key": "source-ticket-123456789",
        },
        body: JSON.stringify({ size: 1, sha256: "a".repeat(64) }),
      },
      {
        INTERNAL_API: {
          fetch: (input) => {
            upstream = input instanceof Request ? input.url : String(input);
            return Promise.resolve(
              Response.json({
                sourceId: `source_${"a".repeat(32)}`,
                uploadRequired: false,
                expiresAt: "2026-08-12T00:00:00.000Z",
              }),
            );
          },
        },
      },
    );
    expect(response.status).toBe(200);
    expect(upstream).toBe(
      "http://internal-api.local/internal/v1/source-tickets",
    );
  });

  it("proxies a bodyless job-ticket renewal without Content-Length", async () => {
    let capturedInit: RequestInit | undefined;
    const internalFetch = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        void input;
        capturedInit = init;
        return Promise.resolve(
          Response.json({
            jobTicket: "ticket",
            expiresAt: "2026-08-12T00:00:00.000Z",
          }),
        );
      },
    );
    const jobId = `job_${"a".repeat(32)}`;
    const response = await gatewayApp.request(
      `/api/v1/job-tickets/${jobId}`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Bearer lrk_11111111111111111111111111111111_1111111111111111111111111111111111111111111",
        },
      },
      { INTERNAL_API: { fetch: internalFetch } },
    );

    expect(response.status).toBe(200);
    expect(internalFetch).toHaveBeenCalledOnce();
    expect(new Headers(capturedInit?.headers).has("Content-Type")).toBe(false);
    expect(capturedInit?.body).toBeUndefined();
    await expect(response.json()).resolves.toMatchObject({
      jobTicket: "ticket",
    });
  });

  it("does not silently discard a body sent to a bodyless endpoint", async () => {
    const internalFetch = vi.fn(() =>
      Promise.resolve(Response.json({ ok: true })),
    );
    const jobId = `job_${"b".repeat(32)}`;
    const response = await gatewayApp.request(
      `/api/v1/job-tickets/${jobId}`,
      {
        method: "POST",
        headers: {
          Authorization:
            "Bearer lrk_11111111111111111111111111111111_1111111111111111111111111111111111111111111",
          "Content-Type": "application/json",
          "Content-Length": "2",
        },
        body: "{}",
      },
      { INTERNAL_API: { fetch: internalFetch } },
    );

    expect(response.status).toBe(400);
    expect(internalFetch).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_BODY_NOT_ALLOWED" },
    });
  });

  it("marks the bodyless public route correctly at runtime", () => {
    expect(
      gatewayRoute("/api/v1/job-tickets/job_" + "a".repeat(32), "POST"),
    ).toMatchObject({ bodyRequired: false, idempotencyRequired: false });
  });
});
