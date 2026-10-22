import { describe, expect, it, vi } from "vitest";
import * as docker from "../apps/renderer-worker/src/docker.js";
import { runWorker } from "../apps/renderer-worker/src/worker.js";
import { recoverStaleLeases } from "../apps/renderer-worker/src/recovery.js";
import {
  pipelineDocument,
  realPipelineImage,
  sourcePipelineFixture,
} from "./helpers/source-pipeline.js";

describe.skipIf(realPipelineImage !== undefined)(
  "PDF lease release ordering with real Worker and SQLite (mock Docker)",
  () => {
    it.each([true, false])(
      "holds the next Job until failed Renderer cleanup is verified (unavailable: %s)",
      async (unavailable) => {
        const f = await sourcePipelineFixture();
        const isolation = vi
          .spyOn(docker, "assertDockerIsolation")
          .mockResolvedValue();
        const stop = vi.mocked(docker.dockerStopVerified),
          originalStop = stop.getMockImplementation();
        if (originalStop === undefined)
          throw new Error("Missing Docker fixture boundary");
        const inspect = vi.spyOn(docker, "runDocker").mockResolvedValue("");
        const log = vi.spyOn(console, "log").mockImplementation(() => {});
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        try {
          const identity = {
            userId: "pipeline_user",
            scopes: ["mcp:render", "mcp:read"] as const,
          };
          const first = await f.renders.createRender(identity, {
            inlineSource: pipelineDocument(),
          });
          const second = await f.renders.createRender(identity, {
            inlineSource: pipelineDocument(1, "Second"),
          });
          f.failNextPdf(1);
          if (unavailable)
            stop.mockRejectedValue(new Error("Daemon unavailable"));
          const abort = new AbortController();
          await runWorker(f.database, f.config, abort.signal, {
            idleDelay: () => {
              if (unavailable) {
                expect(f.database.worker.runtimeState(first.id)).toMatchObject({
                  status: "running",
                  lease_owner: f.config.workerId,
                });
                expect(
                  f.database.worker
                    .staleLeases(new Date(Date.now() + 60_000).toISOString())
                    .map((row) => row.id),
                ).toContain(first.id);
                expect(f.database.jobs.get(second.id)?.status).toBe("queued");
                expect(vi.mocked(docker.spawnRenderer)).toHaveBeenCalledTimes(
                  1,
                );
              }
              abort.abort();
              return Promise.resolve();
            },
          });
          if (!unavailable) {
            expect(f.database.worker.runtimeState(first.id)).toMatchObject({
              status: "failed",
              lease_owner: null,
            });
            expect(f.database.jobs.get(second.id)?.status).toBe("succeeded");
          } else {
            stop.mockImplementation(originalStop);
            f.database.raw
              .prepare("UPDATE jobs SET lease_expires_at=? WHERE id=?")
              .run("2000-01-01T00:00:00.000Z", first.id);
            await recoverStaleLeases(f.database, f.config);
            expect(f.database.worker.runtimeState(first.id)).toMatchObject({
              status: "queued",
              lease_owner: null,
            });
          }
        } finally {
          stop.mockImplementation(originalStop);
          isolation.mockRestore();
          inspect.mockRestore();
          log.mockRestore();
          error.mockRestore();
          await f.close();
        }
      },
    );
  },
);
