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
} from "./index.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("MCP core", () => {
  it("exposes Source and entrypoint tools alongside stable job tools", () => {
    expect(MCP_TOOL_NAMES).toEqual([
      "upload_source",
      "create_render_job",
      "render_project",
      "get_render_status",
      "download_render_artifacts",
      "cancel_render",
      "delete_render",
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

  it("keeps MCP read and write paths inside real allowed roots", async () => {
    const base = await mkdtemp(join(tmpdir(), "mcp-path-test-"));
    temporaryRoots.push(base);
    const allowed = join(base, "allowed"),
      outside = join(base, "outside");
    await mkdir(allowed);
    await mkdir(outside);
    await writeFile(join(allowed, "main.tex"), "test");
    await symlink(outside, join(allowed, "escape"));
    const roots = [await realpath(allowed)];

    await expect(
      resolveAllowedMcpPath(join(allowed, "main.tex"), roots, true),
    ).resolves.toBe(join(allowed, "main.tex"));
    await expect(
      resolveAllowedMcpPath(
        join(allowed, ".render", "result.pdf"),
        roots,
        false,
      ),
    ).resolves.toBe(join(allowed, ".render", "result.pdf"));
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
  });
});
