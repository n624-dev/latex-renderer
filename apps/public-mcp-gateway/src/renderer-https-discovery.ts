import { isIP } from "node:net";
import { requestHttpsJson, type HttpsJsonClient } from "./https-json.js";

export interface RendererHttpsConnection {
  resource: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  responseIncludesIssuer: boolean;
}

export async function discoverRendererHttps(
  input: string,
  limits: { signal: AbortSignal; maxResponseBytes: number },
  request: HttpsJsonClient = requestHttpsJson,
): Promise<RendererHttpsConnection> {
  const parsed = URL.parse(input);
  if (
    !parsed ||
    parsed.protocol !== "https:" ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== "/mcp" ||
    isIP(parsed.hostname.replace(/^\[|\]$/g, "")) ||
    /[\s\\]/u.test(input)
  )
    throw new Error("Use the public HTTPS /mcp URL on port 443");
  const origin = parsed.origin,
    resource = `${origin}/mcp`;
  const requestMetadata = (path: string) =>
    request({
      url: new URL(path, origin),
      trustedOrigin: origin,
      ...limits,
    });
  const protectedResource = await requestMetadata(
    "/.well-known/oauth-protected-resource/mcp",
  );
  if (
    !isObject(protectedResource) ||
    protectedResource.resource !== resource ||
    !Array.isArray(protectedResource.authorization_servers) ||
    protectedResource.authorization_servers.length !== 1 ||
    protectedResource.authorization_servers[0] !== origin
  )
    throw new Error(
      "Renderer resource and authorization server must match the selected HTTPS origin",
    );

  const authorizationServer = await requestMetadata(
    "/.well-known/oauth-authorization-server",
  );
  const authorizationEndpoint = `${origin}/oauth/authorize`;
  const tokenEndpoint = `${origin}/oauth/token`;
  const registrationEndpoint = `${origin}/oauth/register`;
  if (
    !isObject(authorizationServer) ||
    authorizationServer.issuer !== origin ||
    authorizationServer.authorization_endpoint !== authorizationEndpoint ||
    authorizationServer.token_endpoint !== tokenEndpoint ||
    authorizationServer.registration_endpoint !== registrationEndpoint ||
    !includes(authorizationServer.code_challenge_methods_supported, "S256") ||
    !includes(authorizationServer.response_types_supported, "code") ||
    !includes(
      authorizationServer.grant_types_supported,
      "authorization_code",
    ) ||
    !includes(
      authorizationServer.token_endpoint_auth_methods_supported,
      "none",
    ) ||
    (authorizationServer.authorization_response_iss_parameter_supported !==
      undefined &&
      typeof authorizationServer.authorization_response_iss_parameter_supported !==
        "boolean")
  )
    throw new Error(
      "Renderer OAuth discovery returned unsupported authorization settings",
    );

  return {
    issuer: origin,
    resource,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint,
    responseIncludesIssuer:
      authorizationServer.authorization_response_iss_parameter_supported ===
      true,
  };
}

export function validateRendererCallbackIssuer(
  received: string | null,
  connection: RendererHttpsConnection,
): boolean {
  return received === null
    ? !connection.responseIncludesIssuer
    : received === connection.issuer;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes(list: unknown, value: string): boolean {
  return Array.isArray(list) && list.includes(value);
}
