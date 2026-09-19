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
