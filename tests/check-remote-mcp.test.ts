import { describe, it, expect, vi } from "vitest";
import { checkRemoteMcp } from "../deploy/scripts/check-remote-mcp.mjs";
const origin = "https://mcp.example.test";
function fixture() {
  return vi.fn<typeof fetch>().mockImplementation((input) => {
    const path = new URL(input instanceof Request ? input.url : input).pathname;
    const body = path.includes("protected-resource")
      ? { resource: origin + "/mcp", authorization_servers: [origin] }
      : path.includes("authorization-server")
        ? {
            issuer: origin,
            authorization_endpoint: origin + "/oauth/authorize",
            registration_endpoint: origin + "/oauth/register",
            token_endpoint: origin + "/oauth/token",
            code_challenge_methods_supported: ["S256"],
            token_endpoint_auth_methods_supported: ["none"],
          }
        : { error: "invalid_token" };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: path === "/mcp" ? 401 : 200,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
        },
      }),
    );
  });
}
describe("read-only public Remote MCP discovery probe", () => {
  it("checks identity, PKCE, registration metadata and 401 without credentials or a client registration", async () => {
    const fetcher = fixture();
    expect((await checkRemoteMcp(origin, fetcher)).ok).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetcher.mock.calls) {
      expect(url instanceof Request ? url.url : url.toString()).not.toContain(
        "/oauth/register",
      );
      expect(options?.redirect).toBe("manual");
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
    }
  });
  it.each([302, 403, 500])(
    "reports routing failure %s without leaking a response body or cookie",
    async (status) => {
      const fetcher = fixture().mockResolvedValue(
        new Response("DO_NOT_LOG", {
          status,
          headers: {
            "Content-Type": "text/html",
            "Set-Cookie": "DO_NOT_LOG",
            Location: "https://private.example/DO_NOT_LOG",
          },
        }),
      );
      const result = await checkRemoteMcp(origin, fetcher);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toContain("DO_NOT_LOG");
    },
  );
  it("rejects mismatched resource identity and untrusted origin input", async () => {
    const fetcher = fixture().mockResolvedValue(
      new Response(JSON.stringify({ resource: "https://other.example/mcp" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect((await checkRemoteMcp(origin, fetcher)).ok).toBe(false);
    await expect(
      checkRemoteMcp("https://user:secret@example.test/path", fetcher),
    ).rejects.toThrow("HTTPS origin");
    await expect(checkRemoteMcp("DO_NOT_LOG", fetcher)).rejects.toThrow(
      "Expected an HTTPS origin without credentials or path",
    );
  });
});
