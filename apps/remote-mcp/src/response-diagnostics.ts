import { diagnosticRequestId, type McpStage } from "./diagnostics.js";

const MAX_INSPECTION_BYTES = 256 * 1024;
const rpcCodes = new Set([-32700, -32600, -32601, -32602, -32603]);
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export interface McpResponseContext {
  requestId: unknown;
  stage: McpStage;
  requestProtocol: string | null;
  supportedProtocols: readonly string[];
}

// Observe only handshake/catalog replies, as they flow to the caller. Never
// clone/tee a response or wait for a clone to drain before returning it.
export function observeMcpResponse(
  response: Response,
  context: McpResponseContext,
): Response {
  if (context.stage !== "initialize" && context.stage !== "tools/list")
    return response;
  const json =
    response.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json") ?? false;
  // A byte bound must also bound allocation overhead: an array of one-byte
  // chunks could otherwise retain hundreds of thousands of small objects.
  let inspection: Uint8Array | undefined;
  let bytes = 0,
    finished = false;
  const emit = (outcome?: string) => {
    if (finished) return;
    finished = true;
    const fields: Record<string, unknown> = {};
    if (outcome === undefined) {
      outcome = !json
        ? "not_json"
        : bytes === 0
          ? "empty"
          : bytes > MAX_INSPECTION_BYTES
            ? "inspection_limited"
            : "invalid_json";
      if (json && bytes > 0 && bytes <= MAX_INSPECTION_BYTES) {
        try {
          const value: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(
              inspection?.subarray(0, bytes),
            ),
          );
          outcome = "invalid_envelope";
          if (
            object(value) &&
            value.jsonrpc === "2.0" &&
            "result" in value !== "error" in value
          ) {
            if (object(value.error) && Number.isInteger(value.error.code)) {
              outcome = "error";
              fields.rpcCode = rpcCodes.has(Number(value.error.code))
                ? value.error.code
                : "application_error";
            } else if (object(value.result)) {
              outcome = "result";
              if (context.stage === "initialize") {
                const protocol = value.result.protocolVersion;
                fields.protocolVersion =
                  typeof protocol === "string" &&
                  context.supportedProtocols.includes(protocol)
                    ? protocol
                    : "unsupported";
              } else {
                fields.toolCount = Array.isArray(value.result.tools)
                  ? value.result.tools.length
                  : 0;
                fields.catalogShapeValid = validCatalogShape(
                  value.result.tools,
                );
                fields.hasNextCursor =
                  typeof value.result.nextCursor === "string";
              }
            }
          }
        } catch {
          /* Report a fixed classification, never parser messages/body. */
        }
      }
    }
    inspection = undefined;
    const declared = response.headers.get("Content-Length");
    try {
      console.info(
        JSON.stringify({
          event: "remote_mcp.rpc_result",
          requestId: diagnosticRequestId(context.requestId),
          stage: context.stage,
          status: response.status,
          rpcOutcome: outcome,
          responseBytes: bytes,
          requestProtocol:
            context.requestProtocol !== null &&
            context.supportedProtocols.includes(context.requestProtocol)
              ? context.requestProtocol
              : "unspecified_or_unsupported",
          ...(declared !== null
            ? {
                contentLengthMatches:
                  /^(?:0|[1-9][0-9]*)$/.test(declared) &&
                  Number(declared) === bytes,
              }
            : {}),
          ...fields,
        }),
      );
    } catch {
      /* Diagnostic output must not break an otherwise valid response. */
    }
  };
  if (response.body === null) {
    emit();
    return response;
  }
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          emit();
          controller.close();
          return;
        }
        const offset = bytes;
        bytes = Math.min(
          Number.MAX_SAFE_INTEGER,
          bytes + next.value.byteLength,
        );
        if (json && bytes <= MAX_INSPECTION_BYTES) {
          inspection ??= new Uint8Array(MAX_INSPECTION_BYTES);
          inspection.set(next.value, offset);
        } else inspection = undefined;
        controller.enqueue(next.value);
      } catch (error) {
        emit("stream_error");
        controller.error(error);
      }
    },
    async cancel(reason) {
      emit("canceled");
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function validCatalogShape(tools: unknown): boolean {
  if (!Array.isArray(tools)) return false;
  const names = new Set<string>();
  for (const tool of tools) {
    if (
      !object(tool) ||
      typeof tool.name !== "string" ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name) ||
      names.has(tool.name) ||
      !object(tool.inputSchema) ||
      tool.inputSchema.type !== "object" ||
      (tool.outputSchema !== undefined &&
        (!object(tool.outputSchema) || tool.outputSchema.type !== "object"))
    )
      return false;
    names.add(tool.name);
  }
  return true;
}
