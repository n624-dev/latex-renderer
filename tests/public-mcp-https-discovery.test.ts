import { describe, expect, it, vi } from "vitest";
import type { HttpsJsonClient } from "../apps/public-mcp-gateway/src/https-json.js";
import {
  discoverRendererHttps,
  validateRendererCallbackIssuer,
} from "../apps/public-mcp-gateway/src/renderer-https-discovery.js";

const origin = "https://renderer.example.com";
const resource = `${origin}/mcp`;
const limits = { signal: new AbortController().signal, maxResponseBytes: 4096 };
const protection = { resource, authorization_servers: [origin] };
const server = {
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  code_challenge_methods_supported: ["S256"],
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none"],
};

describe("the public gateway's Renderer HTTPS connection", () => {
  it("discovers the exact resource and OAuth endpoints from the selected origin", async () => {
    const request = vi
      .fn<HttpsJsonClient>()
      .mockResolvedValueOnce(protection)
      .mockResolvedValueOnce(server);
    const connection = await discoverRendererHttps(resource, limits, request);
    expect(connection).toEqual({
      resource,
      issuer: origin,
      authorizationEndpoint: `${origin}/oauth/authorize`,
      tokenEndpoint: `${origin}/oauth/token`,
      registrationEndpoint: `${origin}/oauth/register`,
      responseIncludesIssuer: false,
    });
    expect(
      request.mock.calls.map(([options]) => [
        options.url.href,
        options.trustedOrigin,
      ]),
    ).toEqual([
      [`${origin}/.well-known/oauth-protected-resource/mcp`, origin],
      [`${origin}/.well-known/oauth-authorization-server`, origin],
    ]);
  });

  it.each([
    "http://renderer.example.com/mcp",
    "https://renderer.example.com:8443/mcp",
    "https://renderer.example.com/api/mcp",
    "https://renderer.example.com/mcp?config=1",
    "https://renderer.example.com/mcp#config",
    "https://user@renderer.example.com/mcp",
    "https://127.0.0.1/mcp",
  ])("rejects unsupported URLs before discovery %s", async (url) => {
    const request = vi.fn();
    await expect(discoverRendererHttps(url, limits, request)).rejects.toThrow(
      "port 443",
    );
    expect(request).not.toHaveBeenCalled();
  });

  it("stops discovery when the advertised OAuth issuer is on another host", async () => {
    const request = vi.fn().mockResolvedValueOnce({
      ...protection,
      authorization_servers: ["https://another.example.com"],
    });
    await expect(
      discoverRendererHttps(resource, limits, request),
    ).rejects.toThrow("selected HTTPS origin");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each([
    { resource: `${resource}/` },
    { authorization_servers: [`${origin}/`] },
  ])("keeps exact identifiers during discovery", async (change) => {
    const request = vi.fn().mockResolvedValueOnce({ ...protection, ...change });
    await expect(
      discoverRendererHttps(resource, limits, request),
    ).rejects.toThrow();
  });

  it.each([
    { issuer: `${origin}/` },
    { token_endpoint: "https://another.example.com/oauth/token" },
    { registration_endpoint: `${origin}/unrelated` },
    { code_challenge_methods_supported: ["plain"] },
  ])("refuses unexpected OAuth endpoints and settings", async (change) => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(protection)
      .mockResolvedValueOnce({ ...server, ...change });
    await expect(
      discoverRendererHttps(resource, limits, request),
    ).rejects.toThrow("unsupported authorization settings");
  });

  it("requires an exact callback issuer when advertised and checks it whenever present", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(protection)
      .mockResolvedValueOnce({
        ...server,
        authorization_response_iss_parameter_supported: true,
      });
    const strict = await discoverRendererHttps(resource, limits, request);
    expect(validateRendererCallbackIssuer(null, strict)).toBe(false);
    expect(validateRendererCallbackIssuer(`${origin}/`, strict)).toBe(false);
    expect(validateRendererCallbackIssuer(origin, strict)).toBe(true);
    const legacy = { ...strict, responseIncludesIssuer: false };
    expect(validateRendererCallbackIssuer(null, legacy)).toBe(true);
    expect(
      validateRendererCallbackIssuer("https://another.example.com", legacy),
    ).toBe(false);
  });
});
