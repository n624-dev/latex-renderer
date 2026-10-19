import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  downloadJobArtifacts,
  renderSource,
} from "../packages/client-core/src/index.js";
import {
  pipelineDocument,
  realPipelineImage,
  sourcePipelineFixture,
} from "./helpers/source-pipeline.js";
const identity = {
  userId: "pipeline_user",
  scopes: ["mcp:render", "mcp:read"] as const,
};
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
describe(`independent stages with ${realPipelineImage === undefined ? "deterministic boundary (not TeX)" : "real pinned TeX Runtime"}`, () => {
  it("publishes separate verified PDF/SVG generations through the public API and packaged-client core", async () => {
    const f = await sourcePipelineFixture();
    try {
      const source = await f.renders.createSource(identity, [
        {
          path: "main.tex",
          text: pipelineDocument(1, "Equation: \\(a^2+b^2=c^2\\). "),
        },
      ]);
      const result = await renderSource(f.client, source.id, {
        outputs: ["pdf", "svg"],
        outputDirectory: join(f.root, "staged-results"),
        pollTimeoutMs: 120000,
        sleep: f.runNext,
      });
      expect(result.job.status).toBe("succeeded");
      expect(result.job.stages).toMatchObject({
        pdf: { status: "succeeded" },
        svg: { status: "succeeded", attempt: 1 },
      });
      expect(result.artifacts.pdf).toBeDefined();
      expect(result.artifacts.svg.length).toBeGreaterThan(1);
      const bytes = await readFile(result.artifacts.pdf as string);
      expect(digest(bytes)).toBe(result.job.stages?.pdf.sha256);
      const manifest = JSON.parse(
        await readFile(
          join(result.outputDirectory, "svg/manifest.json"),
          "utf8",
        ),
      ) as {
        document: {
          pdfSha256: string;
          sourceSha256: string;
          entrypoint: string;
          attempt: number;
        };
      };
      expect(manifest.document).toMatchObject({
        pdfSha256: digest(bytes),
        sourceSha256: source.sha256,
        entrypoint: "main.tex",
        attempt: 1,
      });
      expect(result.artifacts.svgDiagnostics).toHaveLength(3);
    } finally {
      await f.close();
    }
  });
});
describe.skipIf(realPipelineImage !== undefined)(
  "independent PDF/SVG HTTP and Worker pipeline (deterministic, not TeX)",
  () => {
    it("preserves PDF when SVG is canceled and fences a superseded Worker", async () => {
      for (const loseLease of [false, true]) {
        const f = await sourcePipelineFixture();
        try {
          const job = await f.renders.createRender(identity, {
            inlineSource: pipelineDocument(),
            outputs: ["pdf", "svg"],
          });
          const started = f.holdSvgRenderer(),
            running = f.runNext();
          await started;
          const pdf = await f.renders.artifact(identity, job.id, "result.pdf");
          if (loseLease)
            f.database.raw
              .prepare(
                "UPDATE jobs SET lease_owner='replacement',lease_generation=lease_generation+1 WHERE id=?",
              )
              .run(job.id);
          else
            f.renders.cancel(
              { ...identity, scopes: ["mcp:render", "mcp:read", "mcp:cancel"] },
              job.id,
            );
          await running;
          expect(
            (await f.renders.artifact(identity, job.id, "result.pdf")).bytes,
          ).toEqual(pdf.bytes);
          const state = f.renders.job(identity, job.id);
          expect(state.stages?.pdf.status).toBe("succeeded");
          expect(state.artifacts.some((a) => a.type === "svg")).toBe(false);
          if (!loseLease)
            expect(state).toMatchObject({
              status: "canceled",
              stages: { svg: { status: "canceled" } },
            });
        } finally {
          await f.close();
        }
      }
    });
    it.each(["pdf", "source", "runtime"] as const)(
      "rejects a changed %s on SVG-only retry without overwriting the original PDF",
      async (changed) => {
        const f = await sourcePipelineFixture();
        try {
          const job = await f.renders.createRender(identity, {
            inlineSource: pipelineDocument(),
            outputs: ["pdf", "svg"],
          });
          f.failNextSvg(79);
          await f.runNext();
          const state = f.database.outputStages.checkpoint(job.id);
          expect(state).toBeDefined();
          if (!state) throw new Error("Missing PDF checkpoint");
          const path = join(
              f.storage,
              "jobs",
              job.id,
              "outputs",
              String(state.pdf_generation),
              "result.pdf",
            ),
            original = await readFile(path);
          f.renders.retrySvgRender(identity, job.id, randomUUID());
          if (changed === "pdf") await writeFile(path, "%PDF-changed\n");
          if (changed === "source") {
            const row = f.database.jobs.get(job.id);
            if (!row?.source_id) throw new Error("Missing Source");
            const source = f.database.sources.get(row.source_id);
            if (!source) throw new Error("Missing Source");
            await writeFile(
              join(f.storage, source.storage_key),
              "modified zip",
            );
          }
          if (changed === "runtime")
            f.config.image = `sha256:${"a".repeat(64)}`;
          await f.runNext();
          expect(f.renders.job(identity, job.id).status).toBe("failed");
          expect(f.renders.job(identity, job.id).stages?.pdf).toMatchObject({
            status: "succeeded",
            sha256: digest(original),
          });
          expect(await readFile(path)).toEqual(
            changed === "pdf" ? Buffer.from("%PDF-changed\n") : original,
          );
          if (changed === "runtime")
            expect(f.renders.job(identity, job.id).errorCode).toBe(
              "SVG_RUNTIME_CHANGED",
            );
        } finally {
          await f.close();
        }
      },
    );
    it("returns early for jobs download --pdf-only while SVG is running", async () => {
      const f = await sourcePipelineFixture();
      try {
        const source = await f.renders.createSource(identity, [
          { path: "main.tex", text: pipelineDocument() },
        ]);
        const ticket = await f.client.createSourceJob(
          source.id,
          "main.tex",
          randomUUID(),
          ["pdf", "svg"],
        );
        const started = f.holdSvgRenderer(),
          running = f.runNext();
        await started;
        const downloaded = await downloadJobArtifacts(
          f.client,
          ticket.jobId,
          join(f.root, "early-pdf"),
          { pdfOnly: true, pollTimeoutMs: 2000 },
        );
        expect(downloaded.job.status).toBe("running");
        expect(downloaded.artifacts.pdf).toBeDefined();
        expect(downloaded.artifacts.svg).toEqual([]);
        await f.releaseRenderer();
        await running;
      } finally {
        await f.close();
      }
    });
    it("authenticates and deduplicates SVG retries through the existing public ticket route", async () => {
      const f = await sourcePipelineFixture();
      try {
        const source = await f.renders.createSource(identity, [
          { path: "main.tex", text: pipelineDocument() },
        ]);
        const ticket = await f.client.createSourceJob(
          source.id,
          "main.tex",
          randomUUID(),
          ["pdf", "svg"],
        );
        f.failNextSvg(79);
        await f.runNext();
        const initial = await f.client.job(ticket.jobId, ticket.jobTicket),
          key = randomUUID();
        await expect(
          f.outsider.retrySvgJob(ticket.jobId, key),
        ).rejects.toMatchObject({ code: "JOB_NOT_FOUND" });
        const retry = await f.client.retrySvgJob(ticket.jobId, key);
        await f.client.retrySvgJob(ticket.jobId, key);
        expect(
          (await f.client.job(ticket.jobId, retry.jobTicket)).stages?.svg
            .attempt,
        ).toBe(2);
        await f.runNext();
        const completed = await f.client.job(ticket.jobId, retry.jobTicket);
        expect(completed.status).toBe("succeeded");
        expect(completed.stages?.pdf.sha256).toBe(initial.stages?.pdf.sha256);
      } finally {
        await f.close();
      }
    });
    it("exposes the immutable PDF while SVG is still running", async () => {
      const f = await sourcePipelineFixture();
      try {
        const job = await f.renders.createRender(identity, {
          inlineSource: pipelineDocument(),
          outputs: ["pdf", "svg"],
        });
        const started = f.holdSvgRenderer(),
          running = f.runNext();
        await started;
        const state = f.renders.job(identity, job.id);
        expect(state.status).toBe("running");
        expect(state.stages).toMatchObject({
          pdf: { status: "succeeded" },
          svg: { status: "running" },
        });
        const bytes = await f.renders.artifact(identity, job.id, "result.pdf");
        expect(digest(bytes.bytes)).toBe(state.stages?.pdf.sha256);
        expect(state.previewAvailable).toBe(true);
        await f.releaseRenderer();
        await running;
        expect(f.renders.job(identity, job.id)).toMatchObject({
          status: "succeeded",
          stages: {
            pdf: { status: "succeeded" },
            svg: { status: "succeeded" },
          },
        });
      } finally {
        await f.close();
      }
    });
    it.each([79, 83, 84])(
      "keeps PDF after SVG exit %s and retries only SVG without changing its hash",
      async (code) => {
        const f = await sourcePipelineFixture();
        try {
          const job = await f.renders.createRender(identity, {
            inlineSource: pipelineDocument(),
            outputs: ["pdf", "svg"],
          });
          f.failNextSvg(code);
          await f.runNext();
          const first = f.renders.job(identity, job.id),
            checkpoint = f.database.outputStages.checkpoint(job.id);
          expect(first.stages?.pdf.status).toBe("succeeded");
          expect(first.stages?.svg.status).toBe(
            code === 83 ? "timeout" : "failed",
          );
          const pdf = await f.renders.artifact(identity, job.id, "result.pdf");
          const key = randomUUID();
          f.renders.retrySvgRender(identity, job.id, key);
          f.renders.retrySvgRender(identity, job.id, key);
          expect(f.renders.job(identity, job.id).stages?.svg.attempt).toBe(2);
          expect(
            f.renders
              .job(identity, job.id)
              .artifacts.some((a) => a.relativePath === "svg/compile.log"),
          ).toBe(false);
          await f.runNext();
          const result = f.renders.job(identity, job.id);
          expect(result).toMatchObject({
            status: "succeeded",
            stages: {
              pdf: { status: "succeeded", sha256: digest(pdf.bytes) },
              svg: { status: "succeeded", attempt: 2 },
            },
          });
          expect(
            f.database.outputStages.checkpoint(job.id)?.pdf_generation,
          ).toBe(checkpoint?.pdf_generation);
          expect(
            (await f.renders.artifact(identity, job.id, "result.pdf")).bytes,
          ).toEqual(pdf.bytes);
          const manifest = JSON.parse(
            (
              await f.renders.artifact(identity, job.id, "svg/manifest.json")
            ).bytes.toString(),
          ) as { document: { pdfSha256: string } };
          expect(manifest.document.pdfSha256).toBe(digest(pdf.bytes));
          expect(
            await readFile(
              join(
                f.storage,
                "jobs",
                job.id,
                "outputs",
                String(checkpoint?.pdf_generation),
                "result.pdf",
              ),
            ),
          ).toEqual(pdf.bytes);
        } finally {
          await f.close();
        }
      },
    );
  },
);
