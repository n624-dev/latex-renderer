import { AppError } from "@latex-renderer/shared";
import { describe, expect, it } from "vitest";
import {
  MCP_TOOL_NAMES,
  assertValidMcpOutput,
  mcpFailure,
  renderProjectOutputSchema,
  validateRenderTimeout,
} from "./index.js";

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
    expect(() => validateRenderTimeout(0)).toThrowError(
      "MCP render timeout must be a positive integer",
    );
  });
});
