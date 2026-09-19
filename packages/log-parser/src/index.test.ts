import { describe, expect, it } from "vitest";
import { parseCompileLog, parseRecorder } from "./index.js";

describe("compile log parser", () => {
  it("preserves dot-heavy recorder names without permitting parent components", () => {
    expect(parseRecorder([
      "INPUT /work/input/..draft/main.tex",
      "INPUT /work/input/chapter..v2.tex",
      "INPUT ../outside.tex",
      "INPUT chapters/../../outside.tex",
      "INPUT /etc/passwd",
      "OUTPUT /work/output/..draft/main.aux",
    ].join("\n"))).toEqual({
      inputs: ["..draft/main.tex", "chapter..v2.tex"],
      outputs: ["..draft/main.aux"],
    });
  });
  it("extracts file, line, and message without a backtracking expression", () => {
    expect(
      parseCompileLog(
        "/work/input/main.tex:164: Paragraph ended before the command completed.",
        1,
      ).errors,
    ).toEqual([
      {
        file: "main.tex",
        line: 164,
        message: "Paragraph ended before the command completed.",
      },
    ]);
  });

  it("handles a long malformed diagnostic as ordinary text", () => {
    const result = parseCompileLog(`.tex:0:${" ".repeat(100_000)}`, 1);
    expect(result.errors).toEqual([
      {
        file: "main.tex",
        line: null,
        message: "Compilation failed with exit code 1",
      },
    ]);
  });
});
