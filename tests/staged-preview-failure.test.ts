import { createHash, randomUUID } from "node:crypto";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import * as stage from "../apps/renderer-worker/src/renderer-stage.js";
import { defined } from "./helpers/assert-defined.js";
import {
  pipelineDocument,
  realPipelineImage,
  sourcePipelineFixture,
} from "./helpers/source-pipeline.js";

const identity = {
  userId: "pipeline_user",
  scopes: ["mcp:render", "mcp:read"] as const,
};
const diagnostic =
  "renderer: initial PNG preview unavailable; this page can be requested again";

async function createStagedJob(
  f: Awaited<ReturnType<typeof sourcePipelineFixture>>,
) {
  const source = await f.renders.createSource(identity, [
    { path: "main.tex", text: pipelineDocument() },
  ]);
  return f.client.createSourceJob(source.id, "main.tex", randomUUID(), [
    "pdf",
    "svg",
  ]);
}

it.skipIf(realPipelineImage !== undefined)(
  "serves the staged PDF and its diagnostic after eager PNG failure, then retries page 1 without replacing the PDF",
  async () => {
    const f = await sourcePipelineFixture();
    const render = stage.runRendererStage;
    let failPreview = true;
    const boundary = vi
      .spyOn(stage, "runRendererStage")
      .mockImplementation(async (...args) => {
        const [, , , , output, options] = args;
        if (options.mode === "preview" && failPreview) {
          failPreview = false;
          return { exitCode: 82, timedOut: true, stderr: "" };
        }
        const result = await render(...args);
        if (options.mode === "pdf") {
          // The shell timeout fixture checks this output contract independently.
          await rm(join(output, "previews/page-1.png"));
          await appendFile(join(output, "compile.log"), `${diagnostic}\n`);
          await writeFile(
            join(output, ".preview-info.json"),
            JSON.stringify({
              schemaVersion: 2,
              pages: 1,
              dpi: 150,
              firstPage: "on-demand",
            }),
          );
        }
        return result;
      });
    try {
      const { jobId, jobTicket } = await createStagedJob(f);
      await f.runNext();
      const status = await f.client.job(jobId, jobTicket);
      expect(status).toMatchObject({
        status: "succeeded",
        previewPageCount: 1,
        previews: [],
        stages: { pdf: { status: "succeeded" }, svg: { status: "succeeded" } },
      });
      const pdf = defined(
        status.artifacts.find(
          ({ relativePath }) => relativePath === "result.pdf",
        ),
      );
      const compileLog = defined(
        status.artifacts.find(
          ({ relativePath }) => relativePath === "compile.log",
        ),
      );
      const pdfPath = join(f.root, "download.pdf"),
        logPath = join(f.root, "download.log");
      await f.client.download(
        f.client.artifactUrl(jobId, pdf.relativePath),
        jobTicket,
        pdfPath,
        pdf,
      );
      await f.client.download(
        f.client.artifactUrl(jobId, compileLog.relativePath),
        jobTicket,
        logPath,
        compileLog,
      );
      expect(
        createHash("sha256")
          .update(await readFile(pdfPath))
          .digest("hex"),
      ).toBe(pdf.sha256);
      expect(await readFile(logPath, "utf8")).toContain(diagnostic);
      const generation = defined(
        f.database.artifacts.getDownloadable(jobId, "result.pdf"),
      );

      const url = f.client.previewUrl(jobId, "page-1.png");
      const first = await f.withPreviewWorker(() =>
        fetch(url, { headers: { Authorization: `Bearer ${jobTicket}` } }),
      );
      expect(first.status).toBe(409);
      expect(await first.json()).toMatchObject({
        error: {
          code: "PREVIEW_FAILED",
          previewErrorCode: "PREVIEW_CONVERSION_FAILED",
          retryable: true,
        },
      });
      expect(f.database.previews.get(jobId, 1)).toMatchObject({
        status: "failed",
        attempt: 1,
      });
      f.database.raw
        .prepare(
          "UPDATE job_preview_requests SET updated_at=? WHERE job_id=? AND page=1",
        )
        .run(new Date(Date.now() - 60_000).toISOString(), jobId);
      await f.withPreviewWorker(() =>
        f.client.preparePreview(jobId, 1, jobTicket),
      );
      const recovered = await f.client.job(jobId, jobTicket);
      expect(
        recovered.previews.map(({ relativePath }) => relativePath),
      ).toEqual(["previews/page-1.png"]);
      expect(f.database.previews.get(jobId, 1)).toMatchObject({
        status: "succeeded",
        attempt: 2,
      });
      expect(recovered.stages?.pdf).toEqual(status.stages?.pdf);
      expect(recovered.retentionExpiresAt).toBe(status.retentionExpiresAt);
      expect(f.database.artifacts.getDownloadable(jobId, "result.pdf")).toEqual(
        generation,
      );
    } finally {
      boundary.mockRestore();
      await f.close();
    }
  },
);

it.skipIf(realPipelineImage !== undefined)(
  "rejects an invalid staged PDF and never makes it downloadable",
  async () => {
    const f = await sourcePipelineFixture();
    const render = stage.runRendererStage;
    const boundary = vi
      .spyOn(stage, "runRendererStage")
      .mockImplementation(async (...args) => {
        const result = await render(...args);
        const [, , , , output, options] = args;
        if (options.mode === "pdf")
          await writeFile(join(output, "result.pdf"), "invalid PDF header");
        return result;
      });
    try {
      const { jobId, jobTicket } = await createStagedJob(f);
      await f.runNext();
      const status = await f.client.job(jobId, jobTicket);
      expect(status.status).toBe("failed");
      expect(status.stages?.pdf.status).not.toBe("succeeded");
      expect(
        status.artifacts.some(
          ({ relativePath }) => relativePath === "result.pdf",
        ),
      ).toBe(false);
      expect(status.previews).toEqual([]);
      const response = await fetch(f.client.artifactUrl(jobId, "result.pdf"), {
        headers: { Authorization: `Bearer ${jobTicket}` },
      });
      expect(response.status).toBe(404);
      await response.arrayBuffer();
    } finally {
      boundary.mockRestore();
      await f.close();
    }
  },
);
