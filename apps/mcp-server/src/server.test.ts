import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  MCP_TOOL_NAMES,
  type McpOperations,
  type McpToolName,
} from "@latex-renderer/mcp-core";
import { afterEach, describe, expect, it } from "vitest";
import { createLatexRendererMcpServer } from "./server.js";

const jobId = `job_${"a".repeat(32)}`;
const secret = `lrk_${"b".repeat(32)}_${"C".repeat(43)}`;
const job = {
  id: jobId,
  status: "succeeded" as const,
  sourceSize: 10,
  sourceSha256: "d".repeat(64),
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:01.000Z",
  errorCode: null,
  errorMessage: null,
  retentionExpiresAt: "2026-08-12T00:00:00.000Z",
  artifacts: [],
  previews: [],
};
const artifacts = {
  pdf: "/tmp/output/result.pdf",
  errors: "/tmp/output/errors.json",
  log: "/tmp/output/compile.log",
  job: "/tmp/output/job.json",
  previews: ["/tmp/output/previews/page-1.png"],
};
const operations: McpOperations = {
  uploadSource: () =>
    Promise.resolve({
      success: true,
      operation: "upload_source",
      result: {
        source: {
          sourceId: `source_${"f".repeat(32)}`,
          uploadRequired: true,
          size: 10,
          sha256: "e".repeat(64),
          files: 1,
        },
      },
    }),
  createRenderJob: () =>
    Promise.resolve({
      success: true,
      operation: "create_render_job",
      result: { job },
    }),
  renderProject: () =>
    Promise.resolve({
      success: true,
      operation: "render_project",
      result: {
        job,
        source: {
          sourceId: `source_${"f".repeat(32)}`,
          uploadRequired: true,
          size: 10,
          sha256: "e".repeat(64),
          files: 1,
        },
        outputDirectory: "/tmp/output",
        artifacts,
      },
    }),
  getRenderStatus: () =>
    Promise.resolve({
      success: true,
      operation: "get_render_status",
      result: { job },
    }),
  downloadRenderArtifacts: () =>
    Promise.resolve({
      success: true,
      operation: "download_render_artifacts",
      result: { job, outputDirectory: "/tmp/output", artifacts },
    }),
  cancelRender: () =>
    Promise.resolve({
      success: true,
      operation: "cancel_render",
      result: { jobId, action: "cancel", requested: true },
    }),
  deleteRender: () =>
    Promise.resolve({
      success: true,
      operation: "delete_render",
      result: { jobId, action: "delete", requested: true },
    }),
};

const connections: McpConnection[] = [];
afterEach(async () => {
  await Promise.all(
    connections.splice(0).map((connection) => connection.close()),
  );
});

describe("local MCP v2", () => {
  it("advertises object output schemas and returns structured results for all tools", async () => {
    const connection = await connect(operations);
    const listed = await connection.request("tools/list", {});
    const tools = asRecordArray(asRecord(listed).tools);

    expect(tools.map((tool) => tool.name)).toEqual(MCP_TOOL_NAMES);
    for (const tool of tools)
      expect(asRecord(tool.outputSchema).type).toBe("object");

    const argumentsByTool: Record<McpToolName, Record<string, string>> = {
      upload_source: { path: "/tmp/project" },
      create_render_job: {
        sourceId: `source_${"f".repeat(32)}`,
        entrypoint: "report.tex",
      },
      render_project: { directory: "/tmp/project", entrypoint: "main.tex" },
      get_render_status: { jobId },
      download_render_artifacts: { jobId, outputDirectory: "/tmp/output" },
      cancel_render: { jobId },
      delete_render: { jobId },
    };
    for (const name of MCP_TOOL_NAMES) {
      const result = asRecord(
        await connection.request("tools/call", {
          name,
          arguments: argumentsByTool[name],
        }),
      );
      expect(asRecord(result.structuredContent).operation).toBe(name);
      expect(result.isError).not.toBe(true);
      const text = asRecordArray(result.content)[0]?.text;
      expect(typeof text).toBe("string");
      expect(String(text).length).toBeLessThan(120);
      expect(JSON.stringify(result)).not.toContain("uploadTicket");
      expect(JSON.stringify(result)).not.toContain("jobTicket");
      expect(JSON.stringify(result)).not.toContain("lrk_");
    }
  });

  it("returns a redacted structured error and compatibility text", async () => {
    const connection = await connect({
      ...operations,
      getRenderStatus: () => Promise.reject(new Error(`secret ${secret}`)),
    });
    const result = asRecord(
      await connection.request("tools/call", {
        name: "get_render_status",
        arguments: { jobId },
      }),
    );

    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: "text", text: "get_render_status failed (INTERNAL_ERROR)." },
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).toContain("Internal server error");
  });
});

async function connect(value: McpOperations): Promise<McpConnection> {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = createLatexRendererMcpServer(value, "0.2.0-test");
  const transport = new StdioServerTransport(input, output);
  const pending = new Map<number, (value: unknown) => void>();
  const lines = createInterface({ input: output });
  lines.on("line", (line) => {
    const message = JSON.parse(line) as { id?: number; result?: unknown };
    if (message.id !== undefined) {
      pending.get(message.id)?.(message.result);
      pending.delete(message.id);
    }
  });
  await server.connect(transport);
  let id = 0;
  const request = (method: string, params: Record<string, unknown>) =>
    new Promise<unknown>((resolve) => {
      id += 1;
      pending.set(id, resolve);
      input.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "1.0.0" },
  });
  input.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  const connection = {
    request,
    close: async () => {
      lines.close();
      input.destroy();
      output.destroy();
      await server.close();
    },
  };
  connections.push(connection);
  return connection;
}

interface McpConnection {
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected object");
  return value as Record<string, unknown>;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new Error("Expected array");
  return value.map(asRecord);
}
