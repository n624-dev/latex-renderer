import { describe, expect, it } from "vitest";
import {
  parseSyncResult,
  syncArguments,
} from "../apps/renderer-worker/src/pdf-sync.js";

describe("canonical SyncTeX lookup", () => {
  it("returns only paths belonging to the recorded Source", () => {
    const result = parseSyncResult(
      `SyncTeX result begin
Output:/work/pdf/result.pdf
Input:/usr/share/texmf/format.tex
Line:3
Column:2
Output:/work/pdf/result.pdf
Input:/work/input/chapter/数式.tex
Line:23
Column:-1
Output:/work/pdf/result.pdf
Input:../chapter/数式.tex
Line:7
Column:1
SyncTeX result end
`,
      { direction: "pdf_to_source", page: 1, x: 30, y: 40 },
      new Set(["chapter/数式.tex"]),
    );
    expect(result).toMatchObject({
      state: "candidate",
      sources: [{ path: "chapter/数式.tex", line: 23, column: null }],
      locations: [],
    });
  });

  it("passes a source path as one argument and preserves multiple locations", () => {
    const query = {
      direction: "source_to_pdf",
      path: "chapter/日本語 数式.tex",
      line: 10,
    } as const;
    expect(syncArguments(query)).toEqual([
      "source_to_pdf",
      "10:0:/work/input/chapter/日本語 数式.tex",
    ]);
    expect(
      parseSyncResult(
        `SyncTeX result begin
Output:/work/pdf/result.pdf
Page:1
x:100.500
y:200.000
Output:/work/pdf/result.pdf
Page:2
x:100.500
y:110.000
SyncTeX result end
`,
        query,
        new Set(),
      ),
    ).toMatchObject({
      state: "candidate",
      sources: [],
      locations: [
        { page: 1, x: 100.5, y: 200 },
        { page: 2, x: 100.5, y: 110 },
      ],
    });
    expect(parseSyncResult("diagnostic output", query, new Set()).state).toBe(
      "unknown",
    );
  });
});
