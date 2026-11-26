import { randomUUID } from "node:crypto";
import {
  rendererMcpToolPolicies,
  type RendererMcpScope,
  type RendererMcpTool,
  type RendererRelayOperation,
} from "@latex-renderer/contracts";
import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  type McpHttpHandler,
} from "@modelcontextprotocol/server";
import { AppError } from "@latex-renderer/shared";
import { readBoundedBody } from "@latex-renderer/shared/bounded-body";

export async function dispatchRelayOperation(options: {
  handler: McpHttpHandler;
  publicOrigin: string;
  userId: string;
  clientId: string;
  scopes: readonly RendererMcpScope[];
  operation: RendererRelayOperation;
  signal: AbortSignal;
}): Promise<Response> {
  const { operation, scopes } = options;
  let params: Record<string, unknown>;
  if (operation.method === "tools/call") {
    if (
      operation.name === "get_profile" ||
      operation.name === "verify_attachment_delivery_origin" ||
      !Object.hasOwn(rendererMcpToolPolicies, operation.name)
    )
      throw new AppError(
        "INVALID_RELAY_OPERATION",
        "Unsupported Renderer operation",
        400,
      );
    const { scope } =
      rendererMcpToolPolicies[operation.name as RendererMcpTool];
    if (scope && !scopes.includes(scope))
      throw new AppError(
        "INSUFFICIENT_SCOPE",
        "Renderer operation is not authorized",
        403,
      );
    params = { name: operation.name, arguments: operation.arguments };
  } else {
    if (!scopes.includes("mcp:read"))
      throw new AppError(
        "INSUFFICIENT_SCOPE",
        "Reading requires permission",
        403,
      );
    params = { uri: operation.uri };
  }
  const resource = new URL("/mcp", options.publicOrigin);
  const response = await options.handler.fetch(
    new Request(resource, {
      method: "POST",
      signal: options.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
        "Mcp-Method": operation.method,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: operation.method,
        params,
        id: randomUUID(),
      }),
    }),
    {
      authInfo: {
        token: "relay",
        clientId: options.clientId,
        scopes: [...scopes],
        resource,
        extra: { userId: options.userId },
      },
    },
  );
  if (
    !response.ok ||
    response.headers.get("Content-Type")?.split(";")[0] !== "text/event-stream"
  )
    return response;
  // Legacy Streamable HTTP returns a single JSON-RPC reply in an SSE frame.
  // Only the relay normalizes it; direct MCP clients still use the SDK transport.
  const wire = await readBoundedBody(
    response,
    "text/event-stream",
    32 * 1024 * 1024,
  );
  const message = wire
    .split(/\r?\n/)
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  if (!message)
    throw new AppError(
      "INVALID_RELAY_RESPONSE",
      "Renderer response was incomplete",
      502,
    );
  return Response.json(JSON.parse(message) as unknown);
}
