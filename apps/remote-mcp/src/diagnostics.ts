import { AsyncLocalStorage } from "node:async_hooks";
import { createHmac, randomBytes } from "node:crypto";
import type { OAuthDiagnostic } from "@latex-renderer/remote-mcp-core";
import { diagnosticWriter } from "../../../deploy/scripts/service-diagnostics.mjs";

export type McpStage =
  "initialize" | "notifications/initialized" | "tools/list" | "mcp_request";
const context = new AsyncLocalStorage<{ requestId: string; stage: McpStage }>();
export function oauthDiagnostics(
  storageRoot: string,
): (event: OAuthDiagnostic) => void {
  const write = diagnosticWriter(storageRoot, "remote-mcp"),
    key = randomBytes(32);
  return (event) =>
    write({
      event: "remote_mcp.refresh_result",
      outcome: event.outcome,
      requestId: context.getStore()?.requestId ?? "unavailable",
      ...(event.familyId === undefined
        ? {}
        : {
            family: createHmac("sha256", key)
              .update(event.familyId)
              .digest("hex")
              .slice(0, 16),
          }),
      ...(event.sequence === undefined ? {} : { sequence: event.sequence }),
    });
}
export function diagnosticRequestId(value: unknown): string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value)
    ? value
    : "unavailable";
}
export function withMcpDiagnostics<T>(
  requestId: unknown,
  stage: McpStage,
  action: () => T,
): T {
  return context.run(
    { requestId: diagnosticRequestId(requestId), stage },
    action,
  );
}
export function logMcpProtocolError(error: Error): void {
  const value = "code" in error ? error.code : undefined;
  const code =
    typeof value === "number" &&
    [-32700, -32600, -32601, -32602, -32603].includes(value)
      ? value
      : null;
  console.error(
    JSON.stringify({
      event: "remote_mcp.protocol_error",
      stage: context.getStore()?.stage ?? "mcp_request",
      requestId: context.getStore()?.requestId ?? "unavailable",
      code: code ?? "SDK_ERROR",
      classification:
        code === null
          ? "sdk_error"
          : code === -32603
            ? "internal"
            : "invalid_request",
    }),
  );
}
