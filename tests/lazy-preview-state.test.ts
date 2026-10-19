import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { artifactStoragePath, waitForPreview } from "@latex-renderer/database";
import {
  sourcePipelineFixture,
  pipelineDocument,
} from "./helpers/source-pipeline.js";
import { previewPageCount } from "../apps/renderer-worker/src/preview-metadata.js";

async function fixture(lazy = true) {
  const f = await sourcePipelineFixture();
  try {
    const job = await f.renders.createRender(
      { userId: "pipeline_user", scopes: ["mcp:render", "mcp:read"] },
      { inlineSource: pipelineDocument(3) },
    );
    await f.runNext();
    const artifacts = f.database.artifacts.listDownloadable(job.id),
      pdf = artifacts.find((a) => a.type === "pdf");
    if (!pdf) throw new Error("Missing fixture PDF");
    if (lazy) {
      for (const artifact of artifacts.filter(
        (a) =>
          a.type === "preview" && a.relative_path !== "previews/page-1.png",
      )) {
        f.database.raw
          .prepare("DELETE FROM artifacts WHERE id=?")
          .run(artifact.id);
        await rm(artifactStoragePath(f.storage, artifact));
      }
      f.database.previews.register({
        job_id: job.id,
        pdf_artifact_id: pdf.id,
        pdf_sha256: pdf.sha256,
        page_count: 3,
        runtime_image: f.config.image,
        created_at: new Date().toISOString(),
      });
    }
    return { ...f, job, pdf };
  } catch (error) {
    await f.close();
    throw error;
  }
}
describe("lazy preview durable state (conversion boundary is deterministic, not TeX)", () => {
  it("deduplicates a page request and fences another Worker", async () => {
    const f = await fixture();
    try {
      const now = new Date().toISOString();
      for (let n = 0; n < 2; n++)
        f.database.transaction(() =>
          f.database.previews.request(f.job.id, 2, now),
        );
      const claimed = f.database.transaction(() =>
        f.database.previews.claim("worker", now),
      );
      if (!claimed) throw new Error("Missing preview claim");
      expect(claimed.attempt).toBe(1);
      expect(f.database.previews.claim("other", now)).toBeUndefined();
      expect(f.database.previews.finish(claimed, "other", now, "FAILED")).toBe(
        false,
      );
      expect(f.database.previews.finish(claimed, "worker", now, "FAILED")).toBe(
        true,
      );
      expect(f.database.jobs.get(f.job.id)?.status).toBe("succeeded");
      expect(
        f.database.artifacts.getDownloadable(f.job.id, "result.pdf")?.sha256,
      ).toBe(f.pdf.sha256);
    } finally {
      await f.close();
    }
  });
  it.each([0, 4, 101, 1.5, NaN])(
    "rejects an invalid page %s before queueing",
    async (page) => {
      const f = await fixture();
      try {
        await expect(
          waitForPreview(f.database, f.job.id, page, {}, { timeoutMs: 1 }),
        ).rejects.toMatchObject({ status: 404 });
        expect(
          f.database.previews.claim("worker", new Date().toISOString()),
        ).toBeUndefined();
      } finally {
        await f.close();
      }
    },
  );
  it("bounds waiting and does not extend retention or duplicate queue work", async () => {
    const f = await fixture();
    try {
      const original = f.database.jobs.get(f.job.id)?.completed_at;
      const results = await Promise.allSettled(
        [0, 1].map(() =>
          waitForPreview(f.database, f.job.id, 2, {}, { timeoutMs: 10 }),
        ),
      );
      for (const result of results) {
        expect(result.status).toBe("rejected");
        if (result.status === "rejected")
          expect(result.reason as unknown).toMatchObject({
            code: "PREVIEW_PENDING",
            status: 503,
          });
      }
      expect(f.database.jobs.get(f.job.id)?.completed_at).toBe(original);
      const now = new Date().toISOString();
      expect(f.database.previews.claim("worker", now)?.page).toBe(2);
      expect(f.database.previews.claim("worker", now)).toBeUndefined();
    } finally {
      await f.close();
    }
  });
  it("keeps legacy eagerly generated pages available without new document metadata", async () => {
    const f = await fixture(false);
    try {
      expect(
        (await waitForPreview(f.database, f.job.id, 2)).relative_path,
      ).toBe("previews/page-2.png");
    } finally {
      await f.close();
    }
  });
  it.each(["changed-pdf", "deleting", "expired"])(
    "does not queue from a %s document",
    async (state) => {
      const f = await fixture();
      try {
        if (state === "changed-pdf")
          f.database.raw
            .prepare("UPDATE artifacts SET sha256=? WHERE id=?")
            .run("0".repeat(64), f.pdf.id);
        if (state === "deleting")
          f.database.jobs.markDeleting(f.job.id, new Date().toISOString());
        if (state === "expired")
          f.database.raw
            .prepare(
              "UPDATE jobs SET completed_at='2000-01-01T00:00:00.000Z' WHERE id=?",
            )
            .run(f.job.id);
        await expect(
          waitForPreview(f.database, f.job.id, 2),
        ).rejects.toMatchObject({ status: 404 });
      } finally {
        await f.close();
      }
    },
  );
  it("accepts only bounded sandbox PDF page metadata and the first verified PNG", async () => {
    const f = await fixture(false);
    try {
      const path = f.root,
        artifacts = [
          {
            path: "previews/page-1.png",
            type: "preview",
            size: 8,
            sha256: "0".repeat(64),
          },
        ];
      expect(await previewPageCount(path, artifacts)).toBeUndefined();
      await writeFile(
        join(path, ".preview-info.json"),
        '{"schemaVersion":1,"pages":3,"dpi":150}',
      );
      expect(await previewPageCount(path, artifacts)).toBe(3);
      await expect(previewPageCount(path, [])).rejects.toMatchObject({
        code: "PREVIEW_METADATA_INVALID",
      });
      await writeFile(
        join(path, ".preview-info.json"),
        '{"schemaVersion":1,"pages":101,"dpi":150}',
      );
      await expect(previewPageCount(path, artifacts)).rejects.toMatchObject({
        code: "PREVIEW_METADATA_INVALID",
      });
    } finally {
      await f.close();
    }
  });
});
