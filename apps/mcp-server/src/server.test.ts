import { readFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { AppError, sha256Hex } from "@latex-renderer/shared";
import {
  MCP_TOOL_NAMES,
  createMcpOperations,
  type McpOperations,
  type McpToolName,
} from "@latex-renderer/mcp-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererClient } from "@latex-renderer/api-client";
import { rendererApiAuthoringRoutes } from "@latex-renderer/contracts/renderer-mcp-definitions";
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
  downloadProjectRevisionSource: () =>
    Promise.resolve({
      success: true,
      operation: "get_project_revision_downloads",
      result: {
        projectId,
        revisionId,
        outputDirectory: ".render",
        sourceZip: {
          path: "source.zip",
          filename: "source.zip",
          mimeType: "application/zip",
          size: 10,
          sha256: "e".repeat(64),
        },
      },
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
  it("uses the shared state and cleanup tools through the render-key API", async () => {
    const origin = "https://renderer.example.test";
    const client = new RendererClient(origin, secret);
    const connection = await connect(
      createMcpOperations({ clientFactory: () => Promise.resolve(client) }),
    );
    const listed = asRecordArray(
      asRecord(await connection.request("tools/list", {})).tools,
    );
    const manifest = asRecord(
      JSON.parse(
        await readFile(
          new URL("../../../client/mcpb/manifest.json", import.meta.url),
          "utf8",
        ),
      ),
    );
    expect(listed).toHaveLength(53);
    expect(listed.map(({ name }) => String(name)).sort()).toEqual(
      asRecordArray(manifest.tools)
        .map(({ name }) => String(name))
        .sort(),
    );
    expect(
      listed.find(({ name }) => name === "apply_project_revision_cleanup"),
    ).toMatchObject({
      annotations: { destructiveHint: true },
    });
    const adopted = { projectId, adoptedRevisionId: revisionId };
    const history = { revisionId, offset: 1 };
    const changes = { expectedVersion: 1, entries: [] };
    const reviewInput = {
      revisionId,
      jobId,
      pdfSha256: "f".repeat(64),
      conditionsVersion: 1,
      guideVersion: null,
      checks: [{ type: "visual", status: "not_checked" }],
    };
    const review = {
      ...reviewInput,
      projectId,
      id: "review_fixture",
      runtimeDigest: null,
      createdAt: job.createdAt,
    };
    const selection = { revisionIds: [revisionId] };
    const planHash = "b".repeat(64);
    const usage = {
      projectId,
      measuredAt: job.createdAt,
      physicalBytes: null,
      project: {
        sourceCount: 1,
        sourceBytes: 10,
        outputBytes: 0,
        reservedOutputBytes: 0,
      },
      user: {
        sourceBytes: 10,
        jobAndReservationBytes: 0,
        previewReservationBytes: 0,
        sourceTreeBytes: null,
        draftCacheBytes: 0,
        totalBytes: 10,
        quotaBytes: 100,
      },
    };
    const cases = [
      {
        name: "get_project_document_state",
        input: { conditionsVersion: 1, history },
        method: "GET",
        path:
          "/document-state?" +
          new URLSearchParams({
            conditionsVersion: "1",
            history: JSON.stringify(history),
          }).toString(),
        result: {
          ...adopted,
          conditions: { version: 1, entries: [], createdAt: job.createdAt },
          revisionChanges: { revisionId, items: [], nextOffset: null },
        },
      },
      {
        name: "update_project_document_conditions",
        input: changes,
        method: "PATCH",
        path: "/document-state/conditions",
        result: { projectId, version: 2, entries: [], changed: true },
      },
      {
        name: "adopt_project_revision",
        input: { revisionId, expectedRevisionId: null },
        method: "POST",
        path: "/document-state/adoption",
        result: adopted,
      },
      {
        name: "list_project_pdf_reviews",
        input: { offset: 1 },
        method: "GET",
        path: "/pdf-reviews?offset=1",
        result: { projectId, items: [review], nextOffset: null },
      },
      {
        name: "record_project_pdf_review",
        input: reviewInput,
        method: "POST",
        path: "/pdf-reviews",
        result: { review },
      },
      {
        name: "get_project_storage_usage",
        input: {},
        method: "GET",
        path: "/storage-usage",
        result: usage,
      },
      {
        name: "protect_project_revision",
        input: { revisionId, protected: true },
        method: "POST",
        path: "/revision-protection",
        result: { projectId, revisionId, protected: true },
      },
      {
        name: "plan_project_revision_cleanup",
        input: selection,
        method: "POST",
        path: "/revision-cleanup/plan",
        result: {
          projectId,
          planHash,
          estimatedSourceBytes: 10,
          entries: [
            {
              revisionId,
              sourceId,
              reasons: [],
              sourceBytes: 10,
              references: 1,
            },
          ],
        },
      },
      {
        name: "apply_project_revision_cleanup",
        input: { ...selection, planHash },
        method: "POST",
        path: "/revision-cleanup/apply",
        result: { projectId, removed: [revisionId], estimatedSourceBytes: 10 },
      },
    ];
    const fetch = vi.spyOn(globalThis, "fetch");
    try {
      for (const { name, input, method, path, result } of cases) {
        fetch.mockResolvedValueOnce(Response.json(result));
        await expect(
          connection.request("tools/call", {
            name,
            arguments: { projectId, ...input },
          }),
        ).resolves.toMatchObject({
          structuredContent: { success: true, operation: name, result },
        });
        const [url, init] = fetch.mock.lastCall ?? [];
        expect(url).toBeInstanceOf(URL);
        expect(url instanceof URL && url.href).toBe(
          `${origin}/api/v1/projects/${projectId}${path}`,
        );
        expect(init?.method).toBe(method);
        expect(new Headers(init?.headers).get("Authorization")).toBe(
          `Bearer ${secret}`,
        );
        if (method === "GET") {
          expect(init?.body).toBeUndefined();
        } else {
          expect(
            typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
          ).toEqual(input);
        }
      }
      fetch.mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "DOCUMENT_CONDITIONS_CONFLICT",
              message: "Conditions changed",
              currentVersion: 3,
            },
          },
          { status: 409 },
        ),
      );
      await expect(
        connection.request("tools/call", {
          name: "update_project_document_conditions",
          arguments: { projectId, ...changes },
        }),
      ).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          error: { code: "DOCUMENT_CONDITIONS_CONFLICT", currentVersion: 3 },
        },
      });
    } finally {
      fetch.mockRestore();
    }
  });

  it("saves a verified revision ZIP under an allowed root and preserves it on corruption", async () => {
    const root = await mkdtemp(join(tmpdir(), "local-mcp-revision-download-"));
    const client = new RendererClient("https://renderer.example.test", secret);
    const connection = await connect(
      createMcpOperations({
        allowedRoots: [root],
        clientFactory: () => Promise.resolve(client),
      }),
    );
    const filename = `${revisionId}.zip`;
    const outputDirectory = join(root, "output");
    const path = join(outputDirectory, filename);
    const archive = Buffer.from(
      "504b0506000000000000000000000000000000000000",
      "hex",
    );
    const sha256 = sha256Hex(archive);
    const headers = {
      "Content-Type": "application/zip",
      "X-Source-Zip-Size": String(archive.length),
      ETag: `"${sha256}"`,
    };
    const fetch = vi.spyOn(globalThis, "fetch");
    const call = (output: string) =>
      connection.request("tools/call", {
        name: "get_project_revision_downloads",
        arguments: { projectId, revisionId, outputDirectory: output },
      });
    try {
      await expect(call(tmpdir())).resolves.toMatchObject({
        isError: true,
        structuredContent: { error: { code: "OUTSIDE_ALLOWED_ROOT" } },
      });
      expect(fetch).not.toHaveBeenCalled();
      fetch.mockResolvedValueOnce(new Response(archive, { headers }));
      await expect(call(outputDirectory)).resolves.toMatchObject({
        structuredContent: {
          success: true,
          result: {
            projectId,
            revisionId,
            outputDirectory,
            sourceZip: {
              path,
              filename,
              size: archive.length,
              sha256,
              mimeType: "application/zip",
            },
          },
        },
      });
      const [url, init] = fetch.mock.lastCall ?? [];
      expect(url instanceof URL && url.href).toBe(
        `https://renderer.example.test/api/v1/projects/${projectId}/revisions/${revisionId}/source.zip`,
      );
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${secret}`,
      );
      await expect(readFile(path)).resolves.toEqual(archive);
      fetch.mockResolvedValueOnce(
        new Response(Buffer.alloc(archive.length), { headers }),
      );
      await expect(call(outputDirectory)).resolves.toMatchObject({
        isError: true,
        structuredContent: { error: { code: "ARTIFACT_INTEGRITY_MISMATCH" } },
      });
      await expect(readFile(path)).resolves.toEqual(archive);
      await expect(readdir(outputDirectory)).resolves.toEqual([filename]);
    } finally {
      fetch.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses the scoped Gateway routes for draft and PDF operations and returns recovery details", async () => {
    const client = new RendererClient("https://renderer.example.test/", secret);
    const pdfSha256 = "1".repeat(64);
    const origin = "https://renderer.example.test";
    const calls: Array<{
      path: string;
      method: string;
      body: BodyInit | null | undefined;
    }> = [];
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url, options) => {
        if (!(url instanceof URL)) throw new Error("Expected a URL");
        expect(url.origin).toBe(origin);
        expect(options?.redirect).toBe("error");
        expect(new Headers(options?.headers).get("Authorization")).toBe(
          `Bearer ${secret}`,
        );
        calls.push({
          path: url.pathname + url.search,
          method: options?.method ?? "GET",
          body: options?.body,
        });
        if (url.pathname.endsWith("/draft"))
          return Promise.resolve(Response.json({ draft: null }));
        if (url.pathname.endsWith("/draft/preview"))
          return Promise.resolve(
            Response.json({ jobId, version: 5, reused: true }),
          );
        if (url.pathname.endsWith("/changes"))
          return Promise.resolve(
            Response.json(
              {
                error: {
                  code: "DRAFT_VERSION_CONFLICT",
                  message: "The draft changed",
                  currentVersion: 6,
                },
              },
              { status: 409 },
            ),
          );
        return Promise.resolve(
          Response.json({
            jobId,
            revisionId: null,
            pdfSha256,
            generation: null,
            inspectorVersion: 1,
            expiresAt: "2026-11-28T00:00:00.000Z",
            state: "not_requested",
            errorCode: null,
            report: null,
          }),
        );
      });
    try {
      const connection = await connect({
        ...operations,
        runAuthoringOperation: client.runAuthoringOperation.bind(client),
      });
      const call = (name: string, args: Record<string, unknown>) =>
        connection.request("tools/call", { name, arguments: args });
      await expect(
        call("get_project_draft", { projectId }),
      ).resolves.toMatchObject({
        structuredContent: { success: true, result: { draft: null } },
      });
      const changes = {
        version: 5,
        idempotencyKey: "test-draft-edit-key",
        files: [],
      };
      await expect(
        call("apply_project_changes", { projectId, ...changes }),
      ).resolves.toMatchObject({
        isError: true,
        structuredContent: {
          error: {
            code: "DRAFT_VERSION_CONFLICT",
            status: 409,
            currentVersion: 6,
          },
        },
      });
      await expect(
        call("render_project_draft", { projectId, version: 5 }),
      ).resolves.toMatchObject({
        structuredContent: {
          success: true,
          result: { jobId, version: 5, reused: true },
        },
      });
      await expect(
        call("get_render_quality_report", { jobId, pdfSha256 }),
      ).resolves.toMatchObject({
        structuredContent: {
          success: true,
          result: { pdfSha256, state: "not_requested" },
        },
      });
      expect(calls).toEqual([
        {
          path: `/api/v1/projects/${projectId}/draft`,
          method: "GET",
          body: undefined,
        },
        {
          path: `/api/v1/projects/${projectId}/draft/changes`,
          method: "POST",
          body: JSON.stringify(changes),
        },
        {
          path: `/api/v1/projects/${projectId}/draft/preview`,
          method: "POST",
          body: JSON.stringify({ version: 5 }),
        },
        {
          path: `/api/v1/job-tickets/${jobId}/pdf-inspection?pdfSha256=${pdfSha256}`,
          method: "GET",
          body: undefined,
        },
      ]);
    } finally {
      fetch.mockRestore();
    }
  });

  it("registers the shared tools and forwards environment, log, PDF and retry inputs", async () => {
    const client = new RendererClient("https://renderer.example.test/", secret);
    const pdfSha256 = "1".repeat(64);
    const base64 = "/9g=";
    const idempotencyKey = "retry-job-123456789";
    const crop = { page: 1, x: 0.1, y: 0.2, width: 0.3, height: 0.4 };
    const inspection = {
      jobId,
      revisionId: null,
      pdfSha256,
      generation: 1,
      inspectorVersion: 2,
      expiresAt: "2026-11-28T00:00:00.000Z",
      state: "ready",
      errorCode: null,
    };
    const retried = {
      id: jobId,
      status: "queued",
      engine: "lualatex",
      runtimeDigest: null,
      rendererVersion: "fixture",
      sourceId,
      projectRevisionId: null,
      entrypoint: "main.tex",
      outputs: ["pdf", "svg"],
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      queuedAt: job.updatedAt,
      startedAt: null,
      finishedAt: null,
      retentionExpiresAt: null,
      exitCode: null,
      retryOf: null,
      errorCode: null,
      errorMessage: null,
      previewAvailable: false,
      previewPages: [],
      artifacts: [],
      webResultUrl: `https://renderer.example.test/app/jobs/${jobId}/`,
    };
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((url, options) => {
        if (!(url instanceof URL)) throw new Error("Expected URL");
        expect(new Headers(options?.headers).get("Authorization")).toBe(
          `Bearer ${secret}`,
        );
        expect(options?.redirect).toBe("error");
        switch (url.pathname) {
          case "/api/v1/environment/packages/search":
            expect(url.search).toBe("?query=ams&cursor=2");
            expect(options?.method).toBe("GET");
            return Promise.resolve(
              Response.json({
                search: {
                  query: "ams",
                  matches: ["amsmath"],
                  nextCursor: null,
                },
              }),
            );
          case `/api/v1/job-tickets/${jobId}/log`:
            expect(url.searchParams.get("startLine")).toBe("2");
            expect(url.searchParams.get("stage")).toBe("pdf");
            return Promise.resolve(
              Response.json({
                log: {
                  jobId,
                  stage: "pdf",
                  sha256: pdfSha256,
                  startByte: 2,
                  endByte: 4,
                  totalBytes: 4,
                  startLine: 2,
                  nextByte: null,
                  text: "b\n",
                },
              }),
            );
          case `/api/v1/job-tickets/${jobId}/pdf-inspection`:
            expect(options?.method).toBe("POST");
            expect(options?.body).toBe(
              JSON.stringify({ pdfSha256, params: crop }),
            );
            return Promise.resolve(
              Response.json({
                ...inspection,
                report: {
                  page: 1,
                  normalizedCrop: crop,
                  cropPixels: { x: 1, y: 2, width: 3, height: 4 },
                  displayPagePoints: { width: 10, height: 10 },
                  rotation: 0,
                  dpi: 72,
                  pixelWidth: 3,
                  pixelHeight: 4,
                  mimeType: "image/jpeg",
                  sha256: pdfSha256,
                  base64,
                },
              }),
            );
          case `/api/v1/job-tickets/${jobId}/retry`:
            expect(options?.method).toBe("POST");
            expect(options?.body).toBe(JSON.stringify({ idempotencyKey }));
            return Promise.resolve(
              Response.json({ job: { ...retried, retryOf: jobId } }),
            );
          case "/api/v1/render-tickets":
            expect(options?.method).toBe("POST");
            expect(new Headers(options?.headers).get("Idempotency-Key")).toBe(
              idempotencyKey,
            );
            expect(options?.body).toBe(
              JSON.stringify({ retrySvgJobId: jobId }),
            );
            return Promise.resolve(
              Response.json({
                jobId,
                jobTicket: "fixture-job-ticket",
                expiresAt: inspection.expiresAt,
                job: retried,
              }),
            );
          default:
            throw new Error(`Unexpected route ${url.pathname}`);
        }
      });
    try {
      const connection = await connect({
        ...operations,
        runAuthoringOperation: client.runAuthoringOperation.bind(client),
      });
      const catalog = asRecordArray(
        asRecord(await connection.request("tools/list", {})).tools,
      );
      expect(catalog.map(({ name }) => name)).toEqual(
        expect.arrayContaining(Object.keys(rendererApiAuthoringRoutes)),
      );
      const call = (name: string, args: Record<string, unknown>) =>
        connection.request("tools/call", { name, arguments: args });
      await expect(
        call("search_packages", { query: "ams", cursor: "2" }),
      ).resolves.toMatchObject({
        structuredContent: {
          success: true,
          result: { search: { matches: ["amsmath"] } },
        },
      });
      await expect(
        call("read_render_log", { jobId, startLine: 2 }),
      ).resolves.toMatchObject({
        structuredContent: {
          success: true,
          result: { log: { startLine: 2, text: "b\n" } },
        },
      });
      const preview = asRecord(
        await call("get_render_preview_crop", { jobId, pdfSha256, crop }),
      );
      expect(preview).toMatchObject({
        content: [
          expect.objectContaining({ type: "text" }),
          { type: "image", mimeType: "image/jpeg", data: base64 },
        ],
        structuredContent: {
          success: true,
          result: { crop: { normalizedCrop: crop, sha256: pdfSha256 } },
        },
      });
      expect(JSON.stringify(preview.structuredContent)).not.toContain("base64");
      await expect(
        call("retry_render", { jobId, idempotencyKey }),
      ).resolves.toMatchObject({
        structuredContent: {
          success: true,
          result: { job: { retryOf: jobId } },
        },
      });
      await expect(
        call("retry_svg_render", { jobId, idempotencyKey }),
      ).resolves.toMatchObject({
        structuredContent: { success: true, result: { job: { id: jobId } } },
      });
    } finally {
      fetch.mockRestore();
    }
  });

  it("lists and reads saved revision files with the shared tool schema", async () => {
    const identity = {
      projectId,
      revisionId,
      sourceId,
      sourceSha256: "a".repeat(64),
    };
    const connection = await connect({
      ...operations,
      listProjectRevisionFiles: () =>
        Promise.resolve({
          ...identity,
          items: [{ path: "main.tex", size: 9, kind: "text" }],
          totalFiles: 1,
          nextOffset: null,
        }),
      getProjectRevisionFile: (_projectId, _revisionId, path, options) => {
        if (path !== "main.tex")
          return Promise.reject(
            new AppError("SOURCE_FILE_NOT_FOUND", "File does not exist", 404),
          );
        return Promise.resolve({
          ...identity,
          path,
          sha256: "b".repeat(64),
          size: 9,
          text: "日本語",
          unit: "utf16",
          offset: options?.offset ?? 0,
          totalUnits: 3,
          nextOffset: null,
        });
      },
    });
    const tools = asRecordArray(
      asRecord(await connection.request("tools/list", {})).tools,
    );
    expect(tools.map((tool) => tool.name)).toContain(
      "get_project_revision_file",
    );
    const invoke = (name: string, args: Record<string, unknown>) =>
      connection.request("tools/call", {
        name,
        arguments: { projectId, revisionId, ...args },
      });
    await expect(
      invoke("list_project_revision_files", { limit: 1 }),
    ).resolves.toMatchObject({
      structuredContent: {
        success: true,
        result: { ...identity, totalFiles: 1 },
      },
    });
    await expect(
      invoke("get_project_revision_file", { path: "main.tex" }),
    ).resolves.toMatchObject({
      structuredContent: {
        success: true,
        result: { ...identity, text: "日本語" },
      },
    });
    await expect(
      invoke("get_project_revision_file", { path: "missing.tex" }),
    ).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        success: false,
        error: { code: "SOURCE_FILE_NOT_FOUND", status: 404 },
      },
    });
  });

  it("advertises object output schemas and returns structured results for all tools", async () => {
    const connection = await connect(operations);
    const listed = await connection.request("tools/list", {});
    const tools = asRecordArray(asRecord(listed).tools);

    expect(tools.map((tool) => tool.name)).toEqual([
      ...MCP_TOOL_NAMES,
      "get_authoring_guide",
    ]);
    for (const tool of tools)
      expect(asRecord(tool.outputSchema).type).toBe("object");
    const guide = asRecord(
      await connection.request("tools/call", {
        name: "get_authoring_guide",
        arguments: { topic: "local" },
      }),
    );
    expect(guide.isError).not.toBe(true);
    expect(asRecord(guide.structuredContent)).toMatchObject({
      success: true,
      operation: "get_authoring_guide",
      result: { topic: "local" },
    });
    expect(asRecord(asRecord(guide.structuredContent).result).body).toContain(
      "Local MCP",
    );

    const argumentsByTool: Record<McpToolName, Record<string, string>> = {
      upload_source: { path: "/tmp/project" },
      create_render_job: {
        sourceId: `source_${"f".repeat(32)}`,
        entrypoint: "report.tex",
      },
      render_project: { directory: "/tmp/project", entrypoint: "main.tex" },
      get_render_status: { jobId },
      download_render_artifacts: { jobId, outputDirectory: "/tmp/output" },
      get_project_revision_downloads: { projectId, revisionId },
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
