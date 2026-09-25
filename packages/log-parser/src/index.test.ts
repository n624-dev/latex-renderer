import { describe, expect, it } from "vitest";
import { parseCompileLog, parseRecorder } from "./index.js";

describe("compile log parser", () => {
  it("preserves dot-heavy recorder names without permitting parent components", () => {
    expect(
      parseRecorder(
        [
          "INPUT /work/input/..draft/main.tex",
          "INPUT /work/input/chapter..v2.tex",
          "INPUT ../outside.tex",
          "INPUT chapters/../../outside.tex",
          "INPUT /etc/passwd",
          "OUTPUT /work/output/..draft/main.aux",
        ].join("\n"),
      ),
    ).toEqual({
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

  it("preserves supported TeX source filenames and their compiler line numbers", () => {
    const result = parseCompileLog(
      [
        "/work/input/styles/my package.sty:7: Undefined control sequence.",
        "/work/input/classes/custom.cls:12: Missing } inserted.",
        "/work/input/chapters/CHAPTER.TEX:43: Extra alignment tab.",
        "/work/input/chapters/chapter..v2.tex:8: Illegal parameter number.",
      ].join("\n"),
      1,
    );
    expect(result.errors).toEqual([
      {
        file: "styles/my package.sty",
        line: 7,
        message: "Undefined control sequence.",
      },
      { file: "classes/custom.cls", line: 12, message: "Missing } inserted." },
      {
        file: "chapters/CHAPTER.TEX",
        line: 43,
        message: "Extra alignment tab.",
      },
      {
        file: "chapters/chapter..v2.tex",
        line: 8,
        message: "Illegal parameter number.",
      },
    ]);
  });

  it("uses the actual entrypoint for a fallback error", () => {
    expect(
      parseCompileLog("No structured error", 1, "docs/thesis.tex").errors,
    ).toEqual([
      {
        file: "docs/thesis.tex",
        line: null,
        message: "Compilation failed with exit code 1",
      },
    ]);
  });

  it("uses a stage-specific fallback when a timeout has no file-line error", () => {
    expect(
      parseCompileLog(
        "renderer: PDF preview timed out",
        82,
        "docs/thesis.tex",
        "The PDF preview stage timed out",
      ).errors,
    ).toEqual([
      {
        file: "docs/thesis.tex",
        line: null,
        message: "The PDF preview stage timed out",
      },
    ]);
  });

  it("caps errors and warnings independently", () => {
    const log = [
      ...Array.from(
        { length: 1000 },
        (_, index) => `main.tex:${index + 1}: error`,
      ),
      ...Array.from(
        { length: 1000 },
        () => "LaTeX Warning: undefined reference",
      ),
    ].join("\n");
    const result = parseCompileLog(log, 1);
    expect(result.errors).toHaveLength(200);
    expect(result.warnings).toHaveLength(500);
    expect(result.errors.at(-1)?.line).toBe(200);
  });

  it("keeps the first affected line of overfull and underfull warnings", () => {
    const result = parseCompileLog(
      [
        "Overfull \\hbox (8.0pt too wide) in paragraph at lines 17--20",
        "Underfull \\vbox (badness 10000) at line 31",
        "Overfull \\hbox (8.0pt too wide) in paragraph",
      ].join("\n"),
      0,
    );
    expect(result.warnings.map(({ type, line }) => ({ type, line }))).toEqual([
      { type: "overfull", line: 17 },
      { type: "underfull", line: 31 },
      { type: "overfull", line: null },
    ]);
  });
});
