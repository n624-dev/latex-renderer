import { describe, expect, it } from "vitest";
import { classifyRenderResult } from "../apps/renderer-worker/src/render-result.js";

describe("renderer stage timeout classification", () => {
  it.each([
    [81, "LATEX_COMPILE_TIMEOUT"],
    [82, "PREVIEW_TIMEOUT"],
    [83, "SVG_TIMEOUT"],
  ])("classifies stage exit %i as %s", (exitCode, errorCode) => {
    expect(classifyRenderResult(exitCode, false, "")).toMatchObject({
      status: "timeout",
      errorCode,
      auditAction: "render.timeout",
    });
  });

  it("lets the whole-job timer take priority over a stage exit", () => {
    expect(classifyRenderResult(81, true, "")).toMatchObject({
      status: "timeout",
      errorCode: "JOB_TIMEOUT",
    });
  });

  it("keeps ordinary failure and success classifications", () => {
    expect(classifyRenderResult(1, false, "bad input")).toMatchObject({
      status: "failed",
      errorCode: "LATEX_COMPILE_FAILED",
      errorMessage: "Renderer exited with 1: bad input",
    });
    expect(classifyRenderResult(0, false, "")).toMatchObject({
      status: "succeeded",
      errorCode: null,
    });
  });
});
