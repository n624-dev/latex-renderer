import { documentProbeSchema } from "../packages/contracts/src/index.js";
import { RendererDatabase } from "@latex-renderer/database";
import { describe, expect, it } from "vitest";
import { documentProbeSource } from "../apps/renderer-worker/src/pdf-inspection.js";

describe("isolated document requirements probe", () => {
  it("generates a bounded synthetic Japanese and mathematics fixture", () => {
    const source = documentProbeSource(
      documentProbeSchema.parse({
        engine: "lualatex",
        japanese: true,
        font: "Harano Aji Mincho",
        mathFont: "Latin Modern Math",
        packages: ["amsmath", "amsmath"],
      }),
    );
    expect(source.match(/usepackage\{amsmath\}/g)).toHaveLength(1);
    expect(source).toContain(String.raw`\setmainjfont{Harano Aji Mincho}`);
    expect(source).toContain(String.raw`\setmathfont{Latin Modern Math}`);
    expect(source).toContain("日本語");
  });

  it("rejects TeX markup in names and engine settings outside the fixture contract", () => {
    expect(
      documentProbeSchema.safeParse({
        engine: "lualatex",
        documentClass: String.raw`article}\input{other`,
      }).success,
    ).toBe(false);
    expect(
      documentProbeSchema.safeParse({
        engine: "pdflatex",
        font: "Harano Aji Mincho",
      }).success,
    ).toBe(false);
  });

  it("keeps one result per owner and Runtime and fences completion", () => {
    const db = new RendererDatabase(":memory:");
    try {
      db.migrate();
      const time = "2026-11-26T00:00:00.000Z";
      db.users.insertInvitation({
        id: "user_fixture",
        email: "fixture@example.test",
        displayName: "Fixture",
        role: "admin",
        createdBy: "fixture",
        timestamp: time,
      });
      const input = documentProbeSchema.parse({ engine: "lualatex" });
      const first = db.documentProbes.request(
        "user_fixture",
        "runtime-one",
        input,
        time,
      );
      expect(
        db.documentProbes.request("user_fixture", "runtime-one", input, time)
          .id,
      ).toBe(first.id);
      expect(
        db.documentProbes.request("user_fixture", "runtime-two", input, time)
          .id,
      ).not.toBe(first.id);
      const claimed = db.documentProbes.claim("worker-one", time);
      if (!claimed) throw new Error("Probe was not claimed");
      expect(db.documentProbes.claim("worker-two", time)).toBeUndefined();
      db.documentProbes.finish(claimed.id, "worker-two", "wrong", "failed");
      expect(db.documentProbes.running()?.id).toBe(claimed.id);
      db.documentProbes.finish(
        claimed.id,
        "worker-one",
        "DOCUMENT_PROBE_COMPILED",
        "ready",
      );
      expect(db.documentProbes.running()).toBeUndefined();
    } finally {
      db.close();
    }
  });
});
