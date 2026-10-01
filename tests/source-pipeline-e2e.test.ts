import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  downloadJobArtifacts,
  renderProject,
  renderSource,
} from "../packages/client-core/src/index.js";
import {
  pipelineDocument,
  realPipelineImage,
  sourcePipelineFixture,
} from "./helpers/source-pipeline.js";

describe(`Source pipeline HTTP/DB/Worker E2E (${realPipelineImage === undefined ? "deterministic renderer, NOT TeX" : "real TeX container"})`, () => {
  it("rerenders a project-local custom output, reuses unchanged Source, and removes obsolete pages", async () => {
    const f = await sourcePipelineFixture();
    try {
      const project = join(f.root, "project"),
        output = join(project, "build", "preview");
      await mkdir(project);
      await writeFile(join(project, "main.tex"), pipelineDocument(3));
      const options = {
        outputDirectory: output,
        pollTimeoutMs: 120_000,
        sleep: f.runNext,
      };
      const first = await renderProject(f.client, project, options);
      expect(first.job.status).toBe("succeeded");
      expect(first.artifacts.previews).toHaveLength(3);
      expect(first.source.uploadRequired).toBe(true);
      const second = await renderProject(f.client, project, options);
      expect(second.job.status).toBe("succeeded");
      expect(second.source.sourceId).toBe(first.source.sourceId);
      expect(second.source.uploadRequired).toBe(false);
      expect(f.database.sources.get(first.source.sourceId)?.paths_json).toBe(
        '["main.tex"]',
      );
      expect(f.requests.filter((r) => r.method === "PUT")).toHaveLength(1);
      await writeFile(
        join(project, "main.tex"),
        pipelineDocument(1, "Shorter"),
      );
      const third = await renderProject(f.client, project, options);
      expect(third.job.status).toBe("succeeded");
      expect(third.source.sourceId).not.toBe(first.source.sourceId);
      expect(await readdir(join(output, "previews"))).toEqual(["page-1.png"]);
      const published = JSON.parse(
        await readFile(join(output, "job.json"), "utf8"),
      ) as { id: string };
      expect(published.id).toBe(third.job.id);
      for (const artifact of [
        ...third.job.artifacts,
        ...third.job.previews,
      ].filter((a) => a.type !== "dependencies")) {
        const bytes = await readFile(join(output, artifact.relativePath));
        expect(bytes.byteLength).toBe(artifact.size);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(
          artifact.sha256,
        );
      }
      const dependencies = third.job.artifacts.find(
        (a) => a.type === "dependencies",
      );
      expect(dependencies).toBeDefined();
      if (!dependencies)
        throw new Error("Worker must publish dependency metadata");
      const renewal = await f.client.renewJobTicket(third.job.id);
      const downloadedDependencies = join(f.root, "dependencies.json");
      await f.client.download(
        f.client.artifactUrl(third.job.id, dependencies.relativePath),
        renewal.jobTicket,
        downloadedDependencies,
        dependencies,
      );
      expect(
        JSON.parse(await readFile(downloadedDependencies, "utf8")),
      ).toBeDefined();
      expect(
        f.database.raw
          .prepare("SELECT COUNT(*) AS n FROM artifact_download_leases")
          .get(),
      ).toMatchObject({ n: 0 });
    } finally {
      await f.close();
    }
  });

  it("keeps the old generation intact while jobs download waits for a queued/running Job", async () => {
    const f = await sourcePipelineFixture();
    try {
      const project = join(f.root, "project"),
        output = join(f.root, "results");
      await mkdir(project);
      await writeFile(join(project, "main.tex"), pipelineDocument());
      const first = await renderProject(f.client, project, {
        outputDirectory: output,
        pollTimeoutMs: 120_000,
        sleep: f.runNext,
      });
      const paths = [
        first.artifacts.job,
        first.artifacts.pdf,
        first.artifacts.log,
        first.artifacts.errors,
        ...first.artifacts.previews,
      ].filter((path): path is string => path !== undefined);
      const previous = await Promise.all(
        paths.map(async (path) => ({ path, bytes: await readFile(path) })),
      );
      const assertPrevious = async () => {
        for (const { path, bytes } of previous)
          expect(await readFile(path)).toEqual(bytes);
      };
      const ticket = await f.client.createSourceJob(
        first.source.sourceId,
        "main.tex",
        "pipeline-wait-123456789",
      );
      expect((await f.client.job(ticket.jobId, ticket.jobTicket)).status).toBe(
        "queued",
      );
      let waits = 0;
      const downloaded = await downloadJobArtifacts(
        f.client,
        ticket.jobId,
        output,
        {
          pollTimeoutMs: 120_000,
          sleep: async () => {
            waits++;
            await assertPrevious();
            if (realPipelineImage !== undefined) {
              await f.runNext();
              return;
            }
            const spawned = f.holdNextRenderer();
            const processing = f.runNext();
            try {
              // A pre-spawn Worker failure must reject rather than leaving the
              // spawn handshake pending until the test runner times out.
              await Promise.race([spawned, processing]);
              expect(
                (await f.client.job(ticket.jobId, ticket.jobTicket)).status,
              ).toBe("running");
              await assertPrevious();
            } finally {
              await f.releaseRenderer();
              await processing;
            }
          },
        },
      );
      expect(waits).toBe(1);
      expect(downloaded.job).toMatchObject({
        id: ticket.jobId,
        status: "succeeded",
      });
      expect(
        JSON.parse(await readFile(join(output, "job.json"), "utf8")),
      ).toMatchObject({ id: ticket.jobId });
    } finally {
      await f.close();
    }
  });

  it("rejects a case-colliding MCP revision, then renders a valid immutable revision through the HTTP client", async () => {
    const f = await sourcePipelineFixture();
    try {
      const identity = {
        userId: "pipeline_user",
        scopes: ["mcp:render"] as const,
      };
      const original = await f.renders.createSource(identity, [
        { path: "main.tex", text: pipelineDocument() },
      ]);
      const originalZip = await readFile(
        join(f.storage, "sources", original.id, "source.zip"),
      );
      const count = () =>
        f.database.raw
          .prepare("SELECT COUNT(*) AS n FROM sources WHERE status='ready'")
          .get();
      expect(count()).toMatchObject({ n: 1 });
      await expect(
        f.renders.updateSourceFile(identity, original.id, {
          path: "MAIN.tex",
          text: pipelineDocument(),
        }),
      ).rejects.toMatchObject({ code: "ZIP_DUPLICATE_PATH" });
      expect(count()).toMatchObject({ n: 1 });
      expect(
        await readFile(join(f.storage, "sources", original.id, "source.zip")),
      ).toEqual(originalZip);
      const revised = await f.renders.updateSourceFile(identity, original.id, {
        path: "main.tex",
        text: pipelineDocument(1, "Revised"),
      });
      expect(revised.revisionOf).toBe(original.id);
      expect(revised.id).not.toBe(original.id);
      const result = await renderSource(f.sibling, revised.id, {
        outputDirectory: join(f.root, "revised-result"),
        pollTimeoutMs: 120_000,
        sleep: f.runNext,
      });
      expect(result.job).toMatchObject({
        status: "succeeded",
        sourceId: revised.id,
      });
      expect((await stat(result.artifacts.pdf as string)).size).toBeGreaterThan(
        0,
      );
      expect(f.database.jobs.get(result.job.id)).toMatchObject({
        source_id: revised.id,
        user_id: identity.userId,
      });
      await expect(
        f.outsider.createSourceJob(
          revised.id,
          "main.tex",
          "pipeline-other-123456789",
        ),
      ).rejects.toMatchObject({ status: 409, code: "SOURCE_NOT_READY" });
      expect(f.database.raw.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    } finally {
      await f.close();
    }
  });
});
