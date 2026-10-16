import { isMainModule } from "./is-main-module.mjs";

// Read-only public discovery probe. Never sends credentials, follows a login
// redirect, registers a client or prints response bodies/cookies/URLs.
export async function checkRemoteMcp(origin, fetcher = globalThis.fetch) {
  let url;
  try {
    url = new globalThis.URL(origin);
  } catch {
    throw new Error("Expected an HTTPS origin without credentials or path");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Expected an HTTPS origin without credentials or path");
  const base = url.origin,
    checks = [];
  async function request(stage, path, expected, options = {}) {
    try {
      const response = await fetcher(base + path, {
        ...options,
        redirect: "manual",
        signal: globalThis.AbortSignal.timeout(10_000),
      });
      const contentType =
        response.headers.get("content-type")?.split(";", 1)[0] ?? "missing";
      const result = {
        stage,
        status: response.status,
        json: contentType === "application/json",
        ok: response.status === expected && contentType === "application/json",
      };
      checks.push(result);
      if (!result.ok) {
        await response.body?.cancel();
        return null;
      }
      let text = "";
      let bytes = 0;
      const decoder = new globalThis.TextDecoder();
      const reader = response.body?.getReader();
      if (reader)
        try {
          while (true) {
            const next = await reader.read();
            if (next.done) break;
            bytes += next.value.byteLength;
            if (bytes > 16_384) throw new Error("metadata limit");
            text += decoder.decode(next.value, { stream: true });
          }
        } finally {
          await reader.cancel();
        }
      text += decoder.decode();
      const body = JSON.parse(text);
      if (body === null || typeof body !== "object" || Array.isArray(body))
        throw new Error("Invalid metadata object");
      return { response, body };
    } catch {
      checks.push({ stage, ok: false, reason: "request_or_metadata_failed" });
      return null;
    }
  }
  const resource = await request(
    "resource_discovery",
    "/.well-known/oauth-protected-resource/mcp",
    200,
  );
  if (
    resource &&
    (resource.body.resource !== base + "/mcp" ||
      !Array.isArray(resource.body.authorization_servers) ||
      !resource.body.authorization_servers.includes(base))
  )
    checks.push({ stage: "resource_identity", ok: false });
  const authorization = await request(
    "authorization_discovery",
    "/.well-known/oauth-authorization-server",
    200,
  );
  if (
    authorization &&
    (authorization.body.issuer !== base ||
      authorization.body.authorization_endpoint !== base + "/oauth/authorize" ||
      authorization.body.token_endpoint !== base + "/oauth/token" ||
      authorization.body.registration_endpoint !== base + "/oauth/register" ||
      !Array.isArray(authorization.body.code_challenge_methods_supported) ||
      !authorization.body.code_challenge_methods_supported.includes("S256") ||
      !Array.isArray(
        authorization.body.token_endpoint_auth_methods_supported,
      ) ||
      !authorization.body.token_endpoint_auth_methods_supported.includes(
        "none",
      ))
  )
    checks.push({ stage: "authorization_identity", ok: false });
  const challenge = await request("mcp_challenge", "/mcp", 401, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "discovery-check", version: "1" },
      },
    }),
  });
  if (
    challenge &&
    !challenge.response.headers
      .get("www-authenticate")
      ?.includes(
        `resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
      )
  )
    checks.push({ stage: "challenge_metadata", ok: false });
  return { ok: checks.every((check) => check.ok), checks };
}
if (isMainModule(import.meta.url)) {
  if (process.argv.length !== 3)
    throw new Error("usage: check-remote-mcp.mjs HTTPS_ORIGIN");
  const result = await checkRemoteMcp(process.argv[2]);
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
