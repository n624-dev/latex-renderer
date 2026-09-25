export type RenderResult = {
  status: "succeeded" | "failed" | "timeout";
  errorCode: string | null;
  errorMessage: string | null;
  auditAction: "render.completed" | "render.failed" | "render.timeout";
};

// compile.sh maps GNU timeout's 124/137 into stage-specific exit codes. The
// outer Job timer wins if it also stopped the container.
const stageTimeouts = new Map<number, readonly [string, string]>([
  [81, ["LATEX_COMPILE_TIMEOUT", "The LaTeX compile stage timed out"]],
  [82, ["PREVIEW_TIMEOUT", "The PDF preview stage timed out"]],
  [83, ["SVG_TIMEOUT", "The SVG stage timed out"]],
]);

export function classifyRenderResult(
  exitCode: number,
  jobTimedOut: boolean,
  stderr: string,
): RenderResult {
  if (jobTimedOut)
    return {
      status: "timeout",
      errorCode: "JOB_TIMEOUT",
      errorMessage: "The renderer exceeded the overall job timeout",
      auditAction: "render.timeout",
    };
  if (exitCode === 0)
    return {
      status: "succeeded",
      errorCode: null,
      errorMessage: null,
      auditAction: "render.completed",
    };
  const stage = stageTimeouts.get(exitCode);
  if (stage !== undefined)
    return {
      status: "timeout",
      errorCode: stage[0],
      errorMessage: stage[1],
      auditAction: "render.timeout",
    };
  return {
    status: "failed",
    errorCode: "LATEX_COMPILE_FAILED",
    errorMessage: `Renderer exited with ${exitCode}: ${stderr.slice(0, 500)}`,
    auditAction: "render.failed",
  };
}
