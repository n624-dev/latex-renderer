import { AppError } from "@latex-renderer/shared";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MCP_TOOL_NAMES,
  assertValidMcpOutput,
  mcpFailure,
  renderProjectOutputSchema,
  resolveAllowedMcpPath,
  validateRenderTimeout,
  renderProjectInputSchema,
  createRenderJobInputSchema,
  downloadArtifactsInputSchema,
  createMcpOperations,
} from "./index.js";
import { RendererClient } from "../../api-client/src/index.js";
import type { JobResponse } from "@latex-renderer/contracts";

const temporaryRoots: string[] = [];

async function pathFixture(aliased: boolean): Promise<string> {
  const base = await mkdtemp(join(tmpdir(), "mcp-path-test-"));
  temporaryRoots.push(base);
  if (!aliased) return base;
  const actual = join(base, "real"),
    alias = join(base, "alias");
  await mkdir(actual);
  // Exercise canonicalization on Linux too, not only macOS /var aliases or
  // Windows 8.3 temporary-directory names. Junctions need no Windows privilege.
  await symlink(actual, alias, "junction");
  return alias;
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("MCP core", () => {
  it.each([
    { count: undefined, generated: 0 },
    { count: 0, generated: 0 },
    { count: 12, generated: 1 },
    { count: 12, generated: 12 },
  ])(
    "keeps total preview pages distinct from generated artifacts ($count/$generated)",
    async ({ count, generated }) => {
      const id = `job_${"a".repeat(32)}`;
      const job: JobResponse = {
        id,
        status: "succeeded",
        sourceSize: 1,
        sourceSha256: "b".repeat(64),
        createdAt: "2026-10-22T00:00:00Z",
        updatedAt: "2026-10-22T00:00:00Z",
        errorCode: null,
        errorMessage: null,
        retentionExpiresAt: null,
        artifacts: [],
        previews: Array.from({ length: generated }, (_, i) => ({
          type: "preview",
          relativePath: `previews/page-${i + 1}.png`,
          size: 1,
          sha256: "c".repeat(64),
          createdAt: "2026-10-22T00:00:00Z",
          downloadUrl: `/api/v1/jobs/${id}/previews/page-${i + 1}.png`,
        })),
        ...(count === undefined ? {} : { previewPageCount: count }),
      };
      class FixtureClient extends RendererClient {
        override renewJobTicket() {
          return Promise.resolve({
            jobTicket: "fixture-ticket",
            expiresAt: "2099-01-01T00:00:00Z",
          });
        }
        override job() {
          return Promise.resolve(job);
        }
      }
      const operations = createMcpOperations({
        clientFactory: () =>
          Promise.resolve(
            new FixtureClient("https://renderer.invalid", "fixture-key"),
          ),
      });
      const output = await operations.getRenderStatus(id);
      expect(output.result?.job.previewPageCount).toBe(count);
      expect(output.result?.job.previews).toHaveLength(generated);
      expect(assertValidMcpOutput(output)).toEqual(output);
    },
  );
  it("accepts explicit PDF/SVG and bounded preview pages without weakening strict tool arguments", () => {
    const source = {
      sourceId: `source_${"a".repeat(32)}`,
      outputs: ["pdf", "svg"],
    };
    expect(createRenderJobInputSchema.parse(source).outputs).toEqual([
      "pdf",
      "svg",
    ]);
    expect(
      renderProjectInputSchema.parse({
        directory: ".",
        outputs: ["pdf", "svg"],
      }).outputs,
    ).toEqual(["pdf", "svg"]);
    expect(renderProjectInputSchema.parse({ directory: "." }).outputs).toEqual([
      "pdf",
    ]);
    expect(
      renderProjectInputSchema.safeParse({ directory: ".", outputs: ["png"] })
        .success,
    ).toBe(false);
    expect(
      renderProjectInputSchema.safeParse({ directory: ".", unexpected: true })
        .success,
    ).toBe(false);
    expect(
      downloadArtifactsInputSchema.parse({
        jobId: `job_${"a".repeat(32)}`,
        previewPages: [2, 5],
      }).previewPages,
    ).toEqual([2, 5]);
    expect(
      downloadArtifactsInputSchema.safeParse({
        jobId: `job_${"a".repeat(32)}`,
        previewPages: [101],
      }).success,
    ).toBe(false);
  });
  it("exposes Source and entrypoint tools alongside stable job tools", () => {
    expect(MCP_TOOL_NAMES).toEqual([
      "upload_source",
      "create_render_job",
      "render_project",
      "get_render_status",
      "download_render_artifacts",
      "cancel_render",
      "delete_render",
      "list_projects",
      "get_project",
      "get_project_revision_jobs",
      "create_project",
      "rename_project",
      "delete_project",
      "attach_project_revision",
      "render_project_revision",
    ]);
  });

  it("uses an object-root structured output schema", () => {
    expect(
      renderProjectOutputSchema.safeParse({
        success: false,
        operation: "render_project",
        error: { code: "TEST", message: "failed", status: 500 },
      }).success,
    ).toBe(true);
  });

  it("redacts credentials from structured failures", () => {
    const secret = `lrk_${"a".repeat(32)}_${"B".repeat(43)}`;
    const result = mcpFailure(
      "get_render_status",
      new AppError("FAILED", `upstream included ${secret}`, 502),
    );
    expect(result.error.message).toBe("upstream included [redacted]");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(assertValidMcpOutput(result)).toEqual(result);
  });

  it("requires a bounded positive render timeout", () => {
    expect(validateRenderTimeout(1_000)).toBe(1_000);
    expect(() => validateRenderTimeout(0)).toThrow(
      "MCP render timeout must be a positive integer",
    );
  });

  it.each([false, true])(
    "keeps MCP read and write paths inside real allowed roots (alias: %s)",
    async (aliased) => {
      const base = await pathFixture(aliased);
      const allowed = join(base, "allowed"),
        outside = join(base, "outside");
      await mkdir(allowed);
      await mkdir(outside);
      await writeFile(join(allowed, "main.tex"), "test");
      await symlink(outside, join(allowed, "escape"), "junction");
      const canonicalAllowed = await realpath(allowed);
      const roots = [canonicalAllowed];

      await expect(
        resolveAllowedMcpPath(join(allowed, "main.tex"), roots, true),
      ).resolves.toBe(join(canonicalAllowed, "main.tex"));
      await expect(
        resolveAllowedMcpPath(
          join(allowed, ".render", "result.pdf"),
          roots,
          false,
        ),
      ).resolves.toBe(join(canonicalAllowed, ".render", "result.pdf"));
      await expect(
        resolveAllowedMcpPath(join(outside, "secret.tex"), roots, false),
      ).rejects.toMatchObject({ code: "OUTSIDE_ALLOWED_ROOT" });
      await expect(
        resolveAllowedMcpPath(
          join(allowed, "escape", "secret.tex"),
          roots,
          false,
        ),
      ).rejects.toMatchObject({ code: "OUTSIDE_ALLOWED_ROOT" });
    },
  );

  it.each([false, true])(
    "accepts dot-heavy path components but rejects real parent traversal (alias: %s)",
    async (aliased) => {
      const base = await pathFixture(aliased);
      const allowed = join(base, "allowed"),
        root = join(allowed, "..draft");
      await mkdir(root, { recursive: true });
      const input = join(root, "chapter..v2.tex");
      await writeFile(input, "test");
      const canonicalAllowed = await realpath(allowed);
      const roots = [canonicalAllowed];
      await expect(resolveAllowedMcpPath(input, roots, true)).resolves.toBe(
        await realpath(input),
      );
      const output = join(allowed, "..output", "result.pdf");
      await expect(resolveAllowedMcpPath(output, roots, false)).resolves.toBe(
        join(canonicalAllowed, "..output", "result.pdf"),
      );
      await expect(
        resolveAllowedMcpPath(join(allowed, "..", "escape.tex"), roots, false),
      ).rejects.toMatchObject({ code: "OUTSIDE_ALLOWED_ROOT" });
    },
  );
});
