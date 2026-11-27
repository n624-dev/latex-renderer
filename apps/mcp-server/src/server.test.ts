import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { AppError } from "@latex-renderer/shared";
import {
  MCP_TOOL_NAMES,
  type McpOperations,
  type McpToolName,
} from "@latex-renderer/mcp-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererClient } from "@latex-renderer/api-client";
import { createLatexRendererMcpServer } from "./server.js";

const jobId = `job_${"a".repeat(32)}`;
const projectId = `project_${"c".repeat(32)}`;
const revisionId = `revision_${"d".repeat(32)}`;
const sourceId = `source_${"f".repeat(32)}`;
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
  listProjects: () =>
    Promise.resolve({
      success: true,
      operation: "list_projects",
      result: { page: { items: [], hasMore: false, nextCursor: null } },
    }),
  getProject: () =>
    Promise.resolve({
      success: true,
      operation: "get_project",
      result: {
        project: {
          id: projectId,
          displayName: "Draft",
          createdAt: "2026-08-11T00:00:00.000Z",
          updatedAt: "2026-08-11T00:00:00.000Z",
          revisionCount: 0,
          latestRevision: null,
          revisions: [],
          revisionsHasMore: false,
          revisionsNextCursor: null,
        },
      },
    }),
  getProjectRevisionJobs: () =>
    Promise.resolve({
      success: true,
      operation: "get_project_revision_jobs",
      result: { page: { items: [], hasMore: false, nextCursor: null } },
    }),
  createProject: () =>
    Promise.resolve({
      success: true,
      operation: "create_project",
      result: { project: { id: projectId } },
    }),
  renameProject: () =>
    Promise.resolve({
      success: true,
      operation: "rename_project",
      result: { project: { id: projectId, displayName: "Renamed" } },
    }),
  deleteProject: () =>
    Promise.resolve({
      success: true,
      operation: "delete_project",
      result: { project: { id: projectId, deleted: true } },
    }),
  attachProjectRevision: () =>
    Promise.resolve({
      success: true,
      operation: "attach_project_revision",
      result: {
        revision: {
          id: revisionId,
          projectId,
          sourceId,
          revisionNumber: 1,
          entrypoint: "main.tex",
          outputs: ["pdf"],
        },
      },
    }),
  renderProjectRevision: () =>
    Promise.resolve({
      success: true,
      operation: "render_project_revision",
      result: { projectId, revisionId, job },
    }),
};

const connections: McpConnection[] = [];
afterEach(async () => {
  await Promise.all(
    connections.splice(0).map((connection) => connection.close()),
  );
});

describe("local MCP v2", () => {
  it("uses the scoped Gateway routes for draft and PDF operations and returns recovery details", async () => {
    const client = new RendererClient("https://renderer.example.test/", secret);
    const pdfSha256 = "1".repeat(64);
    const origin = "https://renderer.example.test";
    const calls: Array<{ path: string; method: string; body: BodyInit | null | undefined }> = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation((url, options) => {
      if (!(url instanceof URL)) throw new Error("Expected a URL");
      expect(url.origin).toBe(origin);
      expect(options?.redirect).toBe("error");
      expect(new Headers(options?.headers).get("Authorization")).toBe(`Bearer ${secret}`);
      calls.push({ path: url.pathname + url.search, method: options?.method ?? "GET", body: options?.body });
      if (url.pathname.endsWith("/draft")) return Promise.resolve(Response.json({ draft: null }));
      if (url.pathname.endsWith("/changes")) return Promise.resolve(Response.json({
        error: { code: "DRAFT_VERSION_CONFLICT", message: "The draft changed", currentVersion: 6 },
      }, { status: 409 }));
      return Promise.resolve(Response.json({
        jobId, revisionId: null, pdfSha256, generation: null,
        inspectorVersion: 1, expiresAt: "2026-11-28T00:00:00.000Z",
        state: "not_requested", errorCode: null, report: null,
      }));
    });
    try {
      const connection = await connect({
        ...operations, runAuthoringOperation: client.runAuthoringOperation.bind(client),
      });
      const call = (name: string, args: Record<string, unknown>) =>
        connection.request("tools/call", { name, arguments: args });
      await expect(call("get_project_draft", { projectId })).resolves.toMatchObject({
        structuredContent: { success: true, result: { draft: null } },
      });
      const changes = { version: 5, idempotencyKey: "test-draft-edit-key", files: [] };
      await expect(call("apply_project_changes", { projectId, ...changes })).resolves.toMatchObject({
        isError: true,
        structuredContent: { error: { code: "DRAFT_VERSION_CONFLICT", status: 409, currentVersion: 6 } },
      });
      await expect(call("get_render_quality_report", { jobId, pdfSha256 })).resolves.toMatchObject({
        structuredContent: { success: true, result: { pdfSha256, state: "not_requested" } },
      });
      expect(calls).toEqual([
        { path: `/api/v1/projects/${projectId}/draft`, method: "GET", body: undefined },
        { path: `/api/v1/projects/${projectId}/draft/changes`, method: "POST", body: JSON.stringify(changes) },
        { path: `/api/v1/job-tickets/${jobId}/pdf-inspection?pdfSha256=${pdfSha256}`, method: "GET", body: undefined },
      ]);
    } finally {
      fetch.mockRestore();
    }
  });

  it("lists and reads saved revision files with the shared tool schema", async () => {
    const identity = { projectId, revisionId, sourceId, sourceSha256: "a".repeat(64) };
    const connection = await connect({
      ...operations,
      listProjectRevisionFiles: () => Promise.resolve({
        ...identity, items: [{ path: "main.tex", size: 9, kind: "text" }],
        totalFiles: 1, nextOffset: null,
      }),
      getProjectRevisionFile: (_projectId, _revisionId, path, options) => {
        if (path !== "main.tex")
          return Promise.reject(new AppError("SOURCE_FILE_NOT_FOUND", "File does not exist", 404));
        return Promise.resolve({
          ...identity, path, sha256: "b".repeat(64), size: 9, text: "日本語",
          unit: "utf16", offset: options?.offset ?? 0, totalUnits: 3, nextOffset: null,
        });
      },
    });
    const tools = asRecordArray(asRecord(await connection.request("tools/list", {})).tools);
    expect(tools.map((tool) => tool.name)).toContain("get_project_revision_file");
    const invoke = (name: string, args: Record<string, unknown>) =>
      connection.request("tools/call", { name, arguments: { projectId, revisionId, ...args } });
    await expect(invoke("list_project_revision_files", { limit: 1 })).resolves.toMatchObject({
      structuredContent: { success: true, result: { ...identity, totalFiles: 1 } },
    });
    await expect(invoke("get_project_revision_file", { path: "main.tex" })).resolves.toMatchObject({
      structuredContent: { success: true, result: { ...identity, text: "日本語" } },
    });
    await expect(invoke("get_project_revision_file", { path: "missing.tex" })).resolves.toMatchObject({
      isError: true,
      structuredContent: { success: false, error: { code: "SOURCE_FILE_NOT_FOUND", status: 404 } },
    });
  });

  it("advertises object output schemas and returns structured results for all tools", async () => {
    const connection = await connect(operations);
    const listed = await connection.request("tools/list", {});
    const tools = asRecordArray(asRecord(listed).tools);

    expect(tools.map((tool) => tool.name)).toEqual([...MCP_TOOL_NAMES, "get_authoring_guide"]);
    for (const tool of tools)
      expect(asRecord(tool.outputSchema).type).toBe("object");
    const guide = asRecord(await connection.request("tools/call", {
      name: "get_authoring_guide",
      arguments: { topic: "local" },
    }));
    expect(guide.isError).not.toBe(true);
    expect(asRecord(guide.structuredContent)).toMatchObject({
      success: true,
      operation: "get_authoring_guide",
      result: { topic: "local" },
    });
    expect(asRecord(asRecord(guide.structuredContent).result).body).toContain("Local MCP");

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
      list_projects: {},
      get_project: { projectId },
      get_project_revision_jobs: { projectId, revisionId },
      create_project: { displayName: "Draft" },
      rename_project: { projectId, displayName: "Renamed" },
      delete_project: { projectId },
      attach_project_revision: {
        projectId,
        sourceId,
        entrypoint: "main.tex",
        displayName: "Draft",
        originalFilename: "main.tex",
      },
      render_project_revision: { projectId, revisionId },
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
