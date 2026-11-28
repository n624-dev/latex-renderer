import { createHash } from "node:crypto";
import type { ConnectionAuthorization } from "../../apps/public-mcp-gateway/src/connections.js";
import {
  type GatewayOAuthTokens,
  validateOAuthAuthorizationRequest,
} from "../../apps/public-mcp-gateway/src/oauth-tokens.js";

export function publicGatewayBearer(
  tokens: GatewayOAuthTokens,
  auth: ConnectionAuthorization,
) {
  const redirect = "https://client.example.com/callback",
    verifier = "a".repeat(43),
    client = "test-client";
  const query = new URLSearchParams({
    client_id: client,
    redirect_uri: redirect,
    resource: tokens.resource,
    scope: auth.scopes.join(" "),
    response_type: "code",
    code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const request = validateOAuthAuthorizationRequest(
    query,
    { id: client, redirectUris: [redirect] },
    tokens.resource,
  );
  const consent = tokens.beginConsent(request, {
    lifetimeMs: 60_000,
    capacity: 5,
  });
  const callback = tokens.completeConsent(
    consent,
    request,
    auth.id,
    auth.scopes,
  );
  return tokens.exchangeCode(
    client,
    new URLSearchParams({
      code: callback.searchParams.get("code") ?? "",
      code_verifier: verifier,
      redirect_uri: redirect,
      resource: tokens.resource,
    }),
  ).access_token;
}
