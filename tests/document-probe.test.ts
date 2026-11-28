import { documentProbeSchema } from "../packages/contracts/src/index.js";
import { RendererDatabase } from "@latex-renderer/database";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadWorkerConfig } from "../apps/renderer-worker/src/config.js";
import * as rendererStage from "../apps/renderer-worker/src/renderer-stage.js";
import {
  documentProbeSource,
  processDocumentProbe,
} from "../apps/renderer-worker/src/pdf-inspection.js";

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

  it("records a probe timeout as unverified and clears its working files", async () => {
    const root = await mkdtemp(join(tmpdir(), "document-probe-budget-"));
    const db = new RendererDatabase(":memory:");
    try {
      db.migrate();
      const timestamp = new Date().toISOString();
      db.users.insertInvitation({
        id: "user_probe",
        email: null,
        displayName: "Probe owner",
        role: "user",
        createdBy: "fixture",
        timestamp,
      });
      const image = "sha256:" + "d".repeat(64);
      for (const [key, value] of Object.entries({
        DATABASE_PATH: ":memory:",
        STORAGE_ROOT: root,
        RENDERER_IMAGE: image,
        RENDERER_SECCOMP_PROFILE: "fixture-only",
        WORKER_ID: "probe-worker",
      }))
        vi.stubEnv(key, value);
      const config = { ...loadWorkerConfig(), minFreeStorageBytes: 0 };
      const input = documentProbeSchema.parse({ engine: "lualatex" });
      const requested = db.documentProbes.request(
        "user_probe",
        image,
        input,
        timestamp,
      );
      const claim = db.documentProbes.claim(config.workerId, timestamp);
      if (!claim) throw new Error("Probe was not claimed");
      // A late successful exit must still be reported as a timeout.
      const run = vi
        .spyOn(rendererStage, "runRendererStage")
        .mockResolvedValueOnce({
          exitCode: 0,
          timedOut: true,
          stderr: "",
        });
      await processDocumentProbe(db, config, claim);
      expect(run).toHaveBeenCalledTimes(1);
      expect(
        db.documentProbes.request("user_probe", image, input, timestamp),
      ).toMatchObject({
        id: requested.id,
        status: "failed",
        result_code: "DOCUMENT_PROBE_TIMEOUT",
      });
      expect(db.jobs.countActive()).toBe(0);
      await expect(
        stat(join(root, "pdf-inspections", requested.id)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      db.close();
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
      await rm(root, { recursive: true, force: true });
    }
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
      const otherEngine = db.documentProbes.request(
        "user_fixture",
        "runtime-one",
        documentProbeSchema.parse({ engine: "xelatex" }),
        time,
      );
      expect(otherEngine.id).not.toBe(first.id);
      expect(otherEngine.fingerprint).not.toBe(first.fingerprint);
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
