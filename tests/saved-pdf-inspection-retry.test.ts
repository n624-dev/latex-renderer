import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  processPdfInspection,
  recoverPdfInspections,
} from "../apps/renderer-worker/src/pdf-inspection.js";
import * as docker from "../apps/renderer-worker/src/docker.js";
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
const outsider = { userId: "pipeline_other", scopes: ["mcp:read"] as const };

async function savedPdfFixture() {
  const f = await sourcePipelineFixture({}, { listenForHttp: false });
  try {
    const job = await f.renders.createRender(identity, {
      inlineSource: pipelineDocument(),
    });
    await f.runNext();
    const pdf = defined(
      f.database.artifacts.getDownloadable(job.id, "result.pdf"),
    );
    return { ...f, job, pdf, inspections: f.database.pdfInspections };
  } catch (error) {
    await f.close();
    throw error;
  }
}

describe.skipIf(realPipelineImage !== undefined)(
  "saved Job PDF inspection recovery",
  () => {
    it.each(["storage shortage", "Worker interruption"])(
      "automatically retries the same saved PDF after %s",
      async (fault) => {
        const f = await savedPdfFixture();
        const { job, pdf, inspections, config, renders } = f;
        const convert = vi
          .spyOn(stage, "runRendererStage")
          .mockImplementation(
            async (_db, _config, _job, _input, output, options) => {
              expect(options.mode).toBe("inspection");
              await writeFile(join(output, "page-info"), "Pages: 1\n");
              return { exitCode: 0, timedOut: false, stderr: "" };
            },
          );
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          const request = () =>
            renders.pdfInspection(identity, job.id, pdf.sha256, true);
          const claim = (owner: string) =>
            f.database.transaction(() =>
              inspections.claim(owner, new Date().toISOString()),
            );
          expect(request().state).toBe("queued");
          const initial = defined(claim(config.workerId));
          expect(initial).toMatchObject({
            job_id: job.id,
            artifact_id: pdf.id,
            pdf_sha256: pdf.sha256,
          });
          expect(claim("competing-worker")).toBeUndefined();
          if (fault === "storage shortage") {
            config.minFreeStorageBytes = Number.MAX_SAFE_INTEGER;
            await processPdfInspection(f.database, config, initial);
            config.minFreeStorageBytes = 0;
          } else {
            vi.setSystemTime(new Date(defined(initial.lease_until)));
            expect(claim("competing-worker")).toBeUndefined();
            const stop = vi
              .spyOn(docker, "dockerStopVerified")
              .mockImplementationOnce(() => {
                expect(
                  inspections.owns(
                    initial.id,
                    config.workerId,
                    new Date().toISOString(),
                  ),
                ).toBe(false);
                expect(
                  inspections.finish(initial.id, config.workerId, {
                    json: "{}",
                  }),
                ).toBe(false);
                return Promise.resolve();
              });
            await recoverPdfInspections(f.database, config);
            expect(stop).toHaveBeenCalledWith(
              docker.rendererContainerName(initial.id, 0, "inspection"),
            );
          }
          expect(convert).not.toHaveBeenCalled();
          const queued = defined(inspections.forArtifact(pdf));
          expect(queued).toMatchObject({
            id: initial.id,
            status: "queued",
            retry_count: 1,
            lease_owner: null,
          });
          const retryAt = Date.parse(defined(queued.retry_at));
          vi.setSystemTime(retryAt - 1);
          expect(claim("competing-worker")).toBeUndefined();
          const attempts = await Promise.all([
            Promise.resolve().then(request),
            Promise.resolve().then(request),
          ]);
          expect(attempts).toEqual([attempts[0], attempts[0]]);
          expect(inspections.forArtifact(pdf)?.id).toBe(initial.id);

          vi.setSystemTime(retryAt);
          const next = defined(claim("replacement-worker"));
          expect(next.id).toBe(initial.id);
          expect(claim("competing-worker")).toBeUndefined();
          expect(
            inspections.finish(initial.id, config.workerId, {
              error: "INSUFFICIENT_STORAGE",
            }),
          ).toBe(false);
          await processPdfInspection(
            f.database,
            { ...config, workerId: "replacement-worker" },
            next,
          );
          const ready = renders.pdfInspection(identity, job.id, pdf.sha256);
          expect(ready).toMatchObject({
            state: "ready",
            generation: pdf.storage_generation,
            pdfSha256: pdf.sha256,
            report: { coverage: { totalPages: 1 } },
          });
          expect(request()).toEqual(ready);
          expect(inspections.forArtifact(pdf)?.id).toBe(initial.id);
          expect(claim("competing-worker")).toBeUndefined();
          expect(convert).toHaveBeenCalledOnce();
        } finally {
          vi.useRealTimers();
          convert.mockRestore();
          await f.close();
        }
      },
    );

    it.each([
      {
        name: "exhausted transient retries",
        error: "INSUFFICIENT_STORAGE",
        attempts: 4,
      },
      {
        name: "permanent failure",
        error: "PDF_INSPECTION_FAILED",
        attempts: 1,
      },
      {
        name: "retention before the next retry",
        error: "INSUFFICIENT_STORAGE",
        attempts: 1,
      },
    ])("does not requeue after $name", async ({ name, error, attempts }) => {
      const f = await savedPdfFixture();
      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        const request = () =>
          f.renders.pdfInspection(identity, f.job.id, f.pdf.sha256, true);
        const { expiresAt } = request();
        const id = defined(f.inspections.forArtifact(f.pdf)).id;
        if (name === "retention before the next retry")
          vi.setSystemTime(Date.parse(expiresAt) - 29_999);
        for (let attempt = 0; attempt < attempts; attempt++) {
          const now = new Date().toISOString();
          expect(f.inspections.claim(f.config.workerId, now)).toMatchObject({
            id,
            retry_count: attempt,
          });
          expect(
            f.inspections.finish(id, f.config.workerId, { error }, now),
          ).toBe(true);
          if (attempt + 1 < attempts) {
            const retry = Date.now() + 30_000 * 2 ** attempt;
            expect(f.inspections.get(id)).toMatchObject({
              status: "queued",
              retry_at: new Date(retry).toISOString(),
            });
            vi.setSystemTime(retry);
          }
        }
        expect(request()).toMatchObject({ state: "failed", errorCode: error });
        expect(f.inspections.get(id)).toMatchObject({
          retry_count: attempts - 1,
          retry_at: null,
        });
        expect(
          f.inspections.claim("other", new Date().toISOString()),
        ).toBeUndefined();
        vi.setSystemTime(new Date(expiresAt));
        f.inspections.prune(new Date().toISOString());
        expect(f.inspections.get(id)).toBeUndefined();
        expect(request).toThrow(
          expect.objectContaining({ code: "PDF_UNAVAILABLE" }),
        );
      } finally {
        vi.useRealTimers();
        await f.close();
      }
    });

    // inspectJobPdf runs the ownership check inside a transaction in
    // packages/renderer-core/src/pdf-inspection.ts:108. With no principal yet,
    // packages/remote-mcp-core/src/index.ts:3037 opens a nested transaction,
    // producing ERR_SQLITE_ERROR instead of JOB_NOT_FOUND.
    it.fails(
      "returns JOB_NOT_FOUND on a first inspection request by another user",
      async () => {
        const f = await savedPdfFixture();
        try {
          expect(
            f.database.remoteMcp.principal(outsider.userId),
          ).toBeUndefined();
          expect(() =>
            f.renders.pdfInspection(outsider, f.job.id, f.pdf.sha256, true),
          ).toThrow(expect.objectContaining({ code: "JOB_NOT_FOUND" }));
        } finally {
          await f.close();
        }
      },
    );

    it("enforces ownership and queue quota while allowing an identical queued retry", async () => {
      const f = await savedPdfFixture();
      try {
        const request = () =>
          f.renders.pdfInspection(identity, f.job.id, f.pdf.sha256, true);
        expect(() => f.renders.job(outsider, f.job.id)).toThrow(
          expect.objectContaining({ code: "JOB_NOT_FOUND" }),
        );
        expect(f.database.remoteMcp.principal(outsider.userId)).toBeDefined();
        expect(() =>
          f.renders.pdfInspection(outsider, f.job.id, f.pdf.sha256, true),
        ).toThrow(expect.objectContaining({ code: "JOB_NOT_FOUND" }));
        expect(f.inspections.forArtifact(f.pdf)).toBeUndefined();
        const first = request();
        const claimed = defined(
          f.inspections.claim(f.config.workerId, new Date().toISOString()),
        );
        expect(
          f.inspections.finish(claimed.id, f.config.workerId, {
            error: "INSUFFICIENT_STORAGE",
          }),
        ).toBe(true);
        const crop = (index: number) => ({
          page: 1,
          x: index / 20,
          y: 0,
          width: 0.2,
          height: 0.2,
        });
        for (let index = 0; index < 7; index++)
          expect(
            f.renders.pdfInspection(
              identity,
              f.job.id,
              f.pdf.sha256,
              true,
              crop(index),
            ).state,
          ).toBe("queued");
        expect(() =>
          f.renders.pdfInspection(
            identity,
            f.job.id,
            f.pdf.sha256,
            true,
            crop(7),
          ),
        ).toThrow(expect.objectContaining({ code: "PDF_INSPECTION_BUSY" }));
        expect(request()).toEqual(first);
        expect(f.inspections.forArtifact(f.pdf)?.id).toBe(claimed.id);
      } finally {
        await f.close();
      }
    });
  },
);
