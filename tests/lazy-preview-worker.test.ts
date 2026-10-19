import * as fs from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { artifactStoragePath, waitForPreview } from "@latex-renderer/database";
import {
  sourcePipelineFixture,
  pipelineDocument,
} from "./helpers/source-pipeline.js";
import {
  processPreview,
  recoverPreviewRequests,
} from "../apps/renderer-worker/src/preview-processor.js";
import * as stage from "../apps/renderer-worker/src/renderer-stage.js";
import * as docker from "../apps/renderer-worker/src/docker.js";
import * as artifacts from "../apps/renderer-worker/src/artifact-validator.js";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const f = await sourcePipelineFixture();
  try {
    const job = await f.renders.createRender(
      { userId: "pipeline_user", scopes: ["mcp:render", "mcp:read"] },
      { inlineSource: pipelineDocument(3) },
    );
    await f.runNext();
    const pdf = f.database.artifacts.getDownloadable(job.id, "result.pdf");
    if (!pdf) throw new Error("Missing fixture PDF");
    for (const a of f.database.artifacts
      .listDownloadable(job.id)
      .filter(
        (a) =>
          a.type === "preview" && a.relative_path !== "previews/page-1.png",
      )) {
      f.database.raw.prepare("DELETE FROM artifacts WHERE id=?").run(a.id);
      await fs.rm(artifactStoragePath(f.storage, a));
    }
    f.database.previews.register({
      job_id: job.id,
      pdf_artifact_id: pdf.id,
      pdf_sha256: pdf.sha256,
      page_count: 3,
      runtime_image: f.config.image,
      created_at: new Date().toISOString(),
    });
    f.config.minFreeStorageBytes = 0;
    const spawn = vi
      .spyOn(stage, "runRendererStage")
      .mockImplementation(
        async (_db, _config, _job, _input, output, options) => {
          await fs.mkdir(join(output, "previews"), { recursive: true });
          await fs.writeFile(
            join(output, `previews/page-${options.page}.png`),
            Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
          );
          return { exitCode: 0, timedOut: false, stderr: "" };
        },
      );
    const claim = (page = 2) => {
      const now = new Date().toISOString();
      f.database.transaction(() =>
        f.database.previews.request(job.id, page, now),
      );
      const request = f.database.transaction(() =>
        f.database.previews.claim(f.config.workerId, now),
      );
      if (!request) throw new Error("Missing preview claim");
      return request;
    };
    return { ...f, job, pdf, spawn, claim };
  } catch (error) {
    await f.close();
    throw error;
  }
}

describe("bounded lazy preview publication (fixture conversion, no TeX)", () => {
  it("queues only authenticated HTTP access, waits on the existing URL and advertises real metadata separately from page count", async () => {
    const f = await fixture();
    let pending: Promise<void> | undefined;
    try {
      const row = f.database.jobs.get(f.job.id)!,
        ticket = {
          jobTicket: await f.tickets.issueJob({
            jobId: f.job.id,
            userId: row.user_id,
            serviceAccountId: row.service_account_id,
            apiKeyId: row.api_key_id,
            userSecurityVersion: 1,
            serviceAccountSecurityVersion: 1,
          }),
        },
        url = f.client.previewUrl(f.job.id, "page-2.png");
      expect((await fetch(url)).status).toBe(401);
      expect(f.database.previews.get(f.job.id, 2)).toBeUndefined();
      await expect(f.outsider.renewJobTicket(f.job.id)).rejects.toMatchObject({
        status: 404,
      });
      const before = await f.client.job(f.job.id, ticket.jobTicket);
      expect(before.previewPageCount).toBe(3);
      expect(before.previews).toHaveLength(1);
      pending = f.client.preparePreview(f.job.id, 2, ticket.jobTicket);
      for (let n = 0; n < 100 && !f.database.previews.get(f.job.id, 2); n++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      const request = f.database.previews.claim(
        f.config.workerId,
        new Date().toISOString(),
      );
      if (!request) throw new Error("HTTP did not queue preview");
      await processPreview(f.database, f.config, request);
      await pending;
      const after = await f.client.job(f.job.id, ticket.jobTicket);
      expect(after.previews).toHaveLength(2);
      expect(after.previewPageCount).toBe(3);
      const png = after.previews.find(
        (a) => a.relativePath === "previews/page-2.png",
      )!;
      await f.client.download(
        url,
        ticket.jobTicket,
        join(f.root, "verified-page.png"),
        png,
      );
      expect((await fs.stat(join(f.root, "verified-page.png"))).size).toBe(8);
    } finally {
      await pending?.catch(() => {});
      await f.close();
    }
  });
  it("offers all valid pages to Remote MCP without fabricating ungenerated artifact hashes", async () => {
    const f = await fixture();
    let pending: ReturnType<typeof f.renders.artifact> | undefined;
    try {
      const identity = {
        userId: "pipeline_user",
        scopes: ["mcp:read"] as const,
      };
      const summary = f.renders.job(identity, f.job.id);
      expect(summary.previewPages).toEqual([1, 2, 3]);
      expect(
        summary.artifacts.filter((a) => a.type === "preview"),
      ).toHaveLength(1);
      pending = f.renders.artifact(identity, f.job.id, "previews/page-3.png");
      for (let n = 0; n < 100 && !f.database.previews.get(f.job.id, 3); n++)
        await new Promise((resolve) => setTimeout(resolve, 5));
      const request = f.database.previews.claim(
        f.config.workerId,
        new Date().toISOString(),
      );
      if (!request) throw new Error("MCP did not queue preview");
      await processPreview(f.database, f.config, request);
      expect((await pending).bytes).toHaveLength(8);
    } finally {
      await pending?.catch(() => {});
      await f.close();
    }
  });
  it("publishes a real checksummed PNG into an immutable generation and charges actual bytes without changing the Job/PDF/deadline", async () => {
    const f = await fixture();
    try {
      const before = f.database.jobs.get(f.job.id)!,
        request = f.claim(),
        wait = waitForPreview(f.database, f.job.id, 2, {}, { timeoutMs: 1000 });
      await processPreview(f.database, f.config, request);
      const png = await wait,
        after = f.database.jobs.get(f.job.id)!;
      expect(png.size).toBe(8);
      expect(png.storage_generation).toBeGreaterThan(2 ** 40);
      expect(await fs.readFile(artifactStoragePath(f.storage, png))).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(after.output_size).toBe((before.output_size ?? 0) + 8);
      expect(after.status).toBe(before.status);
      expect(after.completed_at).toBe(before.completed_at);
      expect(
        f.database.artifacts.getDownloadable(f.job.id, "result.pdf"),
      ).toEqual(f.pdf);
      expect(f.database.previews.get(f.job.id, 2)).toMatchObject({
        status: "succeeded",
        reserved_bytes: 0,
      });
      expect(
        await fs.readdir(join(f.storage, "jobs", f.job.id, "preview-attempts")),
      ).toEqual([]);
    } finally {
      await f.close();
    }
  });
  it.each(["quota", "expired", "checksum", "conversion", "ENOSPC"])(
    "preserves PDF and never publishes an unfinished %s preview",
    async (failure) => {
      const f = await fixture();
      try {
        const request = f.claim(),
          original = f.database.jobs.get(f.job.id)!;
        if (failure === "quota")
          f.database.settings.upsert(
            "max_user_storage_bytes",
            1,
            "fixture",
            new Date().toISOString(),
          );
        if (failure === "expired")
          f.database.raw
            .prepare(
              "UPDATE jobs SET completed_at='2000-01-01T00:00:00.000Z' WHERE id=?",
            )
            .run(f.job.id);
        if (failure === "checksum")
          await fs.writeFile(
            artifactStoragePath(f.storage, f.pdf),
            "%PDF-changed",
          );
        if (failure === "conversion")
          f.spawn.mockResolvedValue({
            exitCode: 84,
            timedOut: false,
            stderr: "",
          });
        if (failure === "ENOSPC")
          vi.spyOn(artifacts, "publishArtifacts").mockRejectedValueOnce(
            Object.assign(new Error("full"), { code: "ENOSPC" }),
          );
        await processPreview(f.database, f.config, request);
        expect(
          f.database.artifacts
            .listDownloadable(f.job.id)
            .some((a) => a.relative_path === "previews/page-2.png"),
        ).toBe(false);
        expect(f.database.jobs.get(f.job.id)?.status).toBe(original.status);
        expect(f.database.previews.get(f.job.id, 2)).toMatchObject({
          status: "failed",
          reserved_bytes: 0,
        });
        if (["quota", "expired", "checksum"].includes(failure))
          expect(f.spawn).not.toHaveBeenCalled();
      } finally {
        await f.close();
      }
    },
  );
  it("keeps unknown-daemon work protected, fences the stale publisher and recovers only after verified stop", async () => {
    const f = await fixture();
    try {
      const request = f.claim();
      f.spawn.mockRejectedValue(new docker.RendererCleanupDeferred("unknown"));
      await expect(
        processPreview(f.database, f.config, request),
      ).rejects.toBeInstanceOf(docker.RendererCleanupDeferred);
      const retained = f.database.previews.get(f.job.id, 2)!;
      expect(retained.reserved_bytes).toBeGreaterThan(0);
      expect(
        f.database.previews.claim("other", new Date().toISOString()),
      ).toBeUndefined();
      f.database.raw
        .prepare(
          "UPDATE job_preview_requests SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE sequence=?",
        )
        .run(request.sequence);
      const stop = vi
        .spyOn(docker, "dockerStopVerified")
        .mockRejectedValue(new Error("unavailable"));
      await recoverPreviewRequests(f.database, f.config);
      expect(f.database.previews.owns(request, f.config.workerId)).toBe(false);
      expect(f.database.previews.get(f.job.id, 2)?.reserved_bytes).toBe(
        retained.reserved_bytes,
      );
      f.database.raw
        .prepare(
          "UPDATE job_preview_requests SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE sequence=?",
        )
        .run(request.sequence);
      stop.mockResolvedValue();
      await recoverPreviewRequests(f.database, f.config);
      expect(f.database.previews.get(f.job.id, 2)).toMatchObject({
        status: "failed",
        reserved_bytes: 0,
        error_code: "PREVIEW_INTERRUPTED",
      });
      expect(stop).toHaveBeenLastCalledWith(
        docker.rendererContainerName(f.job.id, request.attempt, 2),
      );
      expect(
        f.database.artifacts.getDownloadable(f.job.id, "result.pdf"),
      ).toEqual(f.pdf);
    } finally {
      await f.close();
    }
  });
  it("serializes ordinary renderer claims and preview claims even after lease expiry", async () => {
    const f = await fixture();
    try {
      const other = await f.renders.createRender(
        { userId: "pipeline_user", scopes: ["mcp:render", "mcp:read"] },
        { inlineSource: pipelineDocument() },
      );
      const request = f.claim();
      f.database.raw
        .prepare(
          "UPDATE job_preview_requests SET lease_expires_at='2000-01-01T00:00:00.000Z' WHERE sequence=?",
        )
        .run(request.sequence);
      expect(
        f.database.worker.claimNext(
          "other",
          new Date().toISOString(),
          new Date(Date.now() + 30000).toISOString(),
        ),
      ).toBeUndefined();
      f.database.previews.finish(
        request,
        f.config.workerId,
        new Date().toISOString(),
        "INTERRUPTED",
      );
      const ordinary = f.database.worker.claimNext(
        "other",
        new Date().toISOString(),
        new Date(Date.now() + 30000).toISOString(),
      );
      expect(ordinary?.id).toBe(other.id);
      f.database.previews.request(f.job.id, 3, new Date().toISOString());
      expect(
        f.database.previews.claim("preview", new Date().toISOString()),
      ).toBeUndefined();
    } finally {
      await f.close();
    }
  });
});
