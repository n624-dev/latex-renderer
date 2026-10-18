import { afterEach, describe, expect, it, vi } from "vitest";
import { observeMcpResponse } from "../apps/remote-mcp/src/response-diagnostics.js";
const context = {
  requestId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  stage: "tools/list",
  requestProtocol: "2025-06-18",
  supportedProtocols: ["2025-06-18"],
} as const;
afterEach(() => vi.restoreAllMocks());
describe("bounded wire MCP response diagnostics", () => {
  it("distinguishes HTTP 200 JSON-RPC errors without logging error data", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: "SECRET_ID",
      error: {
        code: -32602,
        message: "SECRET_TOKEN_COOKIE_SOURCE",
        data: "SECRET_USER",
      },
    });
    const reply = observeMcpResponse(
      new Response(body, { headers: { "Content-Type": "application/json" } }),
      context,
    );
    expect(await reply.text()).toBe(body);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      status: 200,
      rpcOutcome: "error",
      rpcCode: -32602,
      responseBytes: Buffer.byteLength(body),
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });
  it("checks every descriptor's root shape and counts the complete catalog", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [
          { name: "valid", inputSchema: { type: "object" } },
          {
            name: "SECRET_TOOL",
            inputSchema: { type: "object" },
            outputSchema: { anyOf: [] },
          },
        ],
      },
    });
    await observeMcpResponse(
      new Response(body, {
        headers: { "Content-Type": "application/json", "Content-Length": "1" },
      }),
      context,
    ).text();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      rpcOutcome: "result",
      toolCount: 2,
      catalogShapeValid: false,
      contentLengthMatches: false,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET_TOOL");
  });
  it("records only supported negotiated versions", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await observeMcpResponse(
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "2025-06-18" },
      }),
      { ...context, stage: "initialize" },
    ).text();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      protocolVersion: "2025-06-18",
    });
    await observeMcpResponse(
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        result: { protocolVersion: "SECRET_VERSION" },
      }),
      { ...context, stage: "initialize", requestProtocol: "SECRET_HEADER" },
    ).text();
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });
  it("passes large replies through without unbounded inspection or a tee deadlock", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const body = "x".repeat(256 * 1024 + 1);
    const response = new Response(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new TextEncoder().encode(body));
          c.close();
        },
      }),
      { headers: { "Content-Type": "application/json" } },
    );
    expect(await observeMcpResponse(response, context).text()).toBe(body);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      rpcOutcome: "inspection_limited",
      responseBytes: body.length,
    });
  });
  it("inspects a response arriving in one-byte chunks without retaining a chunk array", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    });
    const bytes = new TextEncoder().encode(body);
    let offset = 0;
    const reply = observeMcpResponse(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (offset === bytes.length) controller.close();
            else controller.enqueue(bytes.slice(offset, ++offset));
          },
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
      context,
    );
    expect(await reply.text()).toBe(body);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      rpcOutcome: "result",
      responseBytes: bytes.length,
      catalogShapeValid: true,
    });
  });
  it.each([
    ["{SECRET_BROKEN_JSON", "invalid_json"],
    [JSON.stringify("SECRET_NON_OBJECT"), "invalid_envelope"],
    [
      JSON.stringify({ jsonrpc: "2.0", id: 1, result: {}, error: {} }),
      "invalid_envelope",
    ],
  ])(
    "reports malformed replies without changing bytes",
    async (body, outcome) => {
      const log = vi.spyOn(console, "info").mockImplementation(() => {});
      expect(
        await observeMcpResponse(
          new Response(body, {
            headers: { "Content-Type": "application/json" },
          }),
          context,
        ).text(),
      ).toBe(body);
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
        rpcOutcome: outcome,
      });
      expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
    },
  );
  it("preserves successful catalogs and classifies application errors safely", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      result: {
        tools: [{ name: "SECRET_TOOL", inputSchema: { type: "object" } }],
      },
    });
    expect(
      await observeMcpResponse(Response.json(JSON.parse(body)), context).text(),
    ).toBe(body);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      rpcOutcome: "result",
      catalogShapeValid: true,
      toolCount: 1,
    });
    await observeMcpResponse(
      Response.json({
        jsonrpc: "2.0",
        id: 1,
        error: { code: 456789, message: "SECRET" },
      }),
      context,
    ).text();
    expect(JSON.parse(String(log.mock.calls[1]?.[0]))).toMatchObject({
      rpcOutcome: "error",
      rpcCode: "application_error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });
  it("forwards cancellation without logging its reason", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const cancel = vi.fn();
    const reply = observeMcpResponse(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel,
        }),
      ),
      context,
    );
    await reply.body?.cancel("SECRET_CANCEL");
    expect(cancel).toHaveBeenCalledWith("SECRET_CANCEL");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      rpcOutcome: "canceled",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });
  it("keeps source stream failures as failures without logging their detail", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const reply = observeMcpResponse(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            controller.error(new Error("SECRET_STREAM_FAILURE"));
          },
        }),
      ),
      context,
    );
    await expect(reply.text()).rejects.toThrow("SECRET_STREAM_FAILURE");
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      rpcOutcome: "stream_error",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });
  it("does not fail a valid response if the diagnostic sink fails", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {
      throw new Error("sink failed");
    });
    const reply = Response.json({
      jsonrpc: "2.0",
      id: 1,
      result: { tools: [] },
    });
    await expect(
      observeMcpResponse(reply, context).json(),
    ).resolves.toMatchObject({ result: { tools: [] } });
  });
  it("leaves SSE bytes and headers unchanged without parsing event bodies", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const body = 'event: message\ndata: {"SECRET":"SSE_BODY"}\n\n';
    const reply = observeMcpResponse(
      new Response(body, {
        headers: { "Content-Type": "text/event-stream", "X-Test": "kept" },
      }),
      context,
    );
    expect(reply.headers.get("X-Test")).toBe("kept");
    expect(await reply.text()).toBe(body);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      rpcOutcome: "not_json",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("SECRET");
  });
  it("does not inspect tool results or consume replies before the caller", () => {
    const reply = Response.json({ structuredContent: "SECRET_SOURCE" });
    expect(
      observeMcpResponse(reply, { ...context, stage: "mcp_request" }),
    ).toBe(reply);
    expect(reply.bodyUsed).toBe(false);
  });
});
