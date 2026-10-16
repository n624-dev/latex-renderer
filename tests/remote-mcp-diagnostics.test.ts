import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  diagnosticRequestId,
  logMcpProtocolError,
  withMcpDiagnostics,
} from "../apps/remote-mcp/src/diagnostics.js";
afterEach(() => vi.restoreAllMocks());
describe("bounded per-request MCP diagnostics", () => {
  it("isolates concurrent correlation and never emits error payloads or identifiers", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const first = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      second = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    await Promise.all([
      withMcpDiagnostics(first, "initialize", async () => {
        await delay(10);
        logMcpProtocolError(
          Object.assign(
            new Error("DO_NOT_LOG Source Authorization cookie verifier"),
            { code: -32600 },
          ),
        );
      }),
      withMcpDiagnostics(second, "tools/list", async () => {
        await delay(1);
        logMcpProtocolError(
          Object.assign(new Error("DO_NOT_LOG user_id"), {
            code: "SECRET_CODE_DO_NOT_LOG",
          }),
        );
      }),
    ]);
    const records = log.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
    expect(records).toEqual(
      expect.arrayContaining([
        {
          event: "remote_mcp.protocol_error",
          stage: "initialize",
          requestId: first,
          code: -32600,
          classification: "invalid_request",
        },
        {
          event: "remote_mcp.protocol_error",
          stage: "tools/list",
          requestId: second,
          code: "SDK_ERROR",
          classification: "sdk_error",
        },
      ]),
    );
    expect(JSON.stringify(records)).not.toContain("DO_NOT_LOG");
    expect(diagnosticRequestId("user supplied secret")).toBe("unavailable");
  });
});
