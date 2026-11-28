import { afterEach, describe, it, expect, vi } from "vitest";
import { RendererDatabase, type WorkerJobRow } from "@latex-renderer/database";
import { AppError, DEFAULT_RESOURCE_LIMITS } from "@latex-renderer/shared";
import type { WorkerConfig } from "../apps/renderer-worker/src/config.js";
import * as docker from "../apps/renderer-worker/src/docker.js";
import * as recovery from "../apps/renderer-worker/src/recovery.js";
import * as heartbeat from "../apps/renderer-worker/src/heartbeat.js";
import * as processor from "../apps/renderer-worker/src/job-processor.js";
import * as failure from "../apps/renderer-worker/src/failure.js";
import * as queue from "../apps/renderer-worker/src/queue.js";
import * as admission from "../apps/renderer-worker/src/admission.js";
import * as sourceTrees from "../apps/renderer-worker/src/source-tree-cache.js";
import * as inspections from "../apps/renderer-worker/src/pdf-inspection.js";
import * as previews from "../apps/renderer-worker/src/preview-processor.js";
import { documentProbeSchema } from "../packages/contracts/src/index.js";
import { runWorker } from "../apps/renderer-worker/src/worker.js";
import {
  MIB,
  memoryProfileKey,
  planRenderMemory,
  rememberRenderMemory,
} from "../apps/renderer-worker/src/memory-plan.js";

const databases: RendererDatabase[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});
const job: WorkerJobRow = {
  id: `job_${"a".repeat(32)}`,
  source_size: 1,
  source_sha256: "a".repeat(64),
  status: "validating",
  source_id: null,
  source_storage_key: null,
  entrypoint: "main.tex",
  engine: "lualatex",
  outputs_json: '["pdf"]',
  lease_generation: 1,
};
function fixture() {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const config: WorkerConfig = {
    ...DEFAULT_RESOURCE_LIMITS,
    databasePath: ":memory:",
    storageRoot: "/unused",
    image: `sha256:${"a".repeat(64)}`,
    workerId: "worker-fixture",
    seccompProfile: "/unused/seccomp.json",
    apparmorProfile: undefined,
    maxOutputBytes: 1024,
    maxOutputFileCount: 10,
    maxOutputDirectoryCount: 10,
    maxLogBytes: 1024,
    maxSvgObjects: 10,
    maxSvgBytes: 1024,
    maxSvgTotalBytes: 1024,
    svgConversionTimeoutSeconds: 1,
    containerUid: 10000,
    containerGid: 10000,
    jobTimeoutMs: 1000,
  };
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(docker, "assertDockerIsolation").mockResolvedValue();
  const recover = vi.spyOn(recovery, "recoverStaleLeases").mockResolvedValue(),
    stopped = vi.fn();
  vi.spyOn(heartbeat, "startWorkerHeartbeat").mockReturnValue(stopped);
  const claimed = vi.spyOn(queue, "claimNextJob").mockReturnValue(job),
    processed = vi.spyOn(processor, "processJob").mockResolvedValue(),
    failed = vi.spyOn(failure, "recordFailure").mockResolvedValue();
  return {
    database,
    config,
    recover,
    stopped,
    claimed,
    processed,
    failed,
    abort: new AbortController(),
  };
}
describe("worker stop and orphan-recovery lifecycle", () => {
  it("gives aged probes, previews, and inspections a turn while renders remain queued", async () => {
    const f = fixture();
    const { database, config } = f;
    const timestamp = new Date().toISOString();
    const ago = (seconds: number) =>
      new Date(Date.parse(timestamp) - seconds * 1000).toISOString();
    const userId = "owner";
    database.users.insertInvitation({
      id: userId,
      displayName: "Owner",
      role: "user",
      createdBy: "test",
      timestamp,
    });
    const web = database.webPrincipals.ensure(userId);
    const insertJob = database.raw.prepare(`INSERT INTO jobs
      (id,user_id,service_account_id,api_key_id,status,renderer_version,
       source_size,source_sha256,created_at,updated_at,queued_at,completed_at)
      VALUES (?,?,?,?,?,'test',1,?,?,?,?,?)`);
    insertJob.run(
      job.id,
      userId,
      web.service_account_id,
      web.api_key_id,
      "queued",
      job.source_sha256,
      timestamp,
      timestamp,
      timestamp,
      null,
    );
    const publishedId = `job_${"b".repeat(32)}`;
    insertJob.run(
      publishedId,
      userId,
      web.service_account_id,
      web.api_key_id,
      "succeeded",
      job.source_sha256,
      ago(90),
      ago(90),
      ago(90),
      ago(90),
    );
    const pdf = {
      id: "artifact_pdf",
      job_id: publishedId,
      type: "pdf",
      relative_path: "result.pdf",
      storage_generation: 1,
      size: 1,
      sha256: "b".repeat(64),
      created_at: ago(90),
    };
    database.artifacts.insert(pdf);
    database.previews.register({
      job_id: publishedId,
      pdf_artifact_id: pdf.id,
      pdf_sha256: pdf.sha256,
      page_count: 2,
      runtime_image: config.image,
      created_at: ago(90),
    });
    const probe = database.documentProbes.request(
      userId,
      config.image,
      documentProbeSchema.parse({ engine: "lualatex" }),
      ago(80),
    );
    database.previews.request(publishedId, 2, ago(70));
    const expiration = new Date(Date.parse(timestamp) + 60_000).toISOString();
    const olderInspection = database.pdfInspections.request(
      pdf,
      expiration,
      ago(60),
    );
    const newerInspection = database.pdfInspections.request(
      pdf,
      expiration,
      ago(50),
      {
        direction: "source_to_pdf",
        path: "main.tex",
        line: 1,
      },
    );

    const dispatched: string[] = [];
    f.processed.mockImplementation(() => {
      dispatched.push("render");
      expect(database.worker.nextQueued()?.id).toBe(job.id);
      if (f.processed.mock.calls.length === 4) f.abort.abort();
      return Promise.resolve();
    });
    vi.spyOn(inspections, "processDocumentProbe").mockImplementation(
      (_db, _config, request) => {
        dispatched.push(request.id);
        database.documentProbes.finish(
          request.id,
          config.workerId,
          "DOCUMENT_PROBE_COMPILED",
          "ready",
        );
        return Promise.resolve();
      },
    );
    vi.spyOn(previews, "processPreview").mockImplementation(
      (_db, _config, request) => {
        dispatched.push(`preview:${request.job_id}:${request.page}`);
        database.raw
          .prepare(
            "UPDATE job_preview_requests SET status='succeeded' WHERE sequence=?",
          )
          .run(request.sequence);
        return Promise.resolve();
      },
    );
    vi.spyOn(inspections, "processPdfInspection").mockImplementation(
      (_db, _config, request) => {
        dispatched.push(request.id);
        database.raw
          .prepare("UPDATE pdf_inspections SET status='ready' WHERE id=?")
          .run(request.id);
        return Promise.resolve();
      },
    );

    await runWorker(database, config, f.abort.signal);

    expect(dispatched).toEqual([
      "render",
      probe.id,
      "render",
      `preview:${publishedId}:2`,
      "render",
      olderInspection.id,
      "render",
    ]);
    expect(database.pdfInspections.get(newerInspection.id)?.status).toBe(
      "queued",
    );
  });

  it("exits only after the full empty-queue deadline and successful maintenance", async () => {
    const f = fixture();
    f.claimed.mockReturnValue(undefined);
    vi.spyOn(sourceTrees, "collectSourceTrees").mockResolvedValue();
    vi.spyOn(sourceTrees, "recoverSourceTreeReaders").mockResolvedValue();
    let elapsed = 0;
    await runWorker(f.database, f.config, f.abort.signal, {
      idle: { timeoutMs: 30000, now: () => elapsed },
      idleDelay: () => {
        elapsed += 10000;
        if (elapsed > 50000) throw new Error("Worker did not idle");
        return Promise.resolve();
      },
    });
    expect(elapsed).toBe(30000);
    expect(f.stopped).toHaveBeenCalledOnce();
    expect(f.processed).not.toHaveBeenCalled();
  });
  it("keeps the Worker alive when maintenance could not finish safely", async () => {
    const f = fixture();
    f.claimed.mockReturnValue(undefined);
    vi.spyOn(sourceTrees, "collectSourceTrees").mockRejectedValue(
      new Error("I/O unavailable"),
    );
    vi.spyOn(sourceTrees, "recoverSourceTreeReaders").mockResolvedValue();
    let elapsed = 0;
    await runWorker(f.database, f.config, f.abort.signal, {
      idle: { timeoutMs: 30000, now: () => elapsed },
      idleDelay: () => {
        elapsed += 20000;
        if (elapsed >= 60000) f.abort.abort();
        return Promise.resolve();
      },
    });
    expect(elapsed).toBe(60000);
    expect(f.database.settings.value("worker_maintenance", null)).toBeNull();
  });
  it("invalidates a lightweight prediction after actual memory exhaustion without retrying it in a loop", async () => {
    const f = fixture();
    f.config.minimumAvailableMemoryBytes = 500 * MIB;
    const candidate = {
      id: job.id,
      user_id: "owner",
      source_sha256: "b".repeat(64),
      entrypoint: "main.tex",
      engine: "lualatex" as const,
      outputs_json: '["pdf"]',
      queued_at: new Date().toISOString(),
    };
    vi.spyOn(f.database.worker, "admissionCandidates").mockReturnValue([
      candidate,
    ]);
    rememberRenderMemory(
      f.database,
      memoryProfileKey(candidate, f.config.image),
      191 * MIB,
      true,
    );
    vi.spyOn(admission, "readHostResources").mockReturnValue({
      availableBytes: 750 * MIB,
      memoryStallPercent: 0,
      ioStallPercent: 0,
    });
    f.processed.mockImplementation(() => {
      f.abort.abort();
      return Promise.reject(
        new AppError("RENDERER_MEMORY_LIMIT", "Memory limit exceeded"),
      );
    });
    await runWorker(f.database, f.config, f.abort.signal);
    expect(f.processed).toHaveBeenCalledOnce();
    expect(f.failed).toHaveBeenCalledOnce();
    expect(
      planRenderMemory(f.database, candidate, f.config.image, 832 * MIB)
        .estimatedPeak,
    ).toBeNull();
  });
  it("lets a Job grow beyond its historical peak up to the configured ceiling", async () => {
    const f = fixture();
    f.config.minimumAvailableMemoryBytes = 500 * MIB;
    f.config.maximumMemoryBytes = 2048 * MIB;
    const heavy = {
      id: "job_heavy",
      user_id: "owner",
      source_sha256: "b".repeat(64),
      entrypoint: "main.tex",
      engine: "lualatex" as const,
      outputs_json: '["pdf"]',
      queued_at: new Date(Date.now() - 1000000).toISOString(),
    };
    const light = { ...heavy, id: job.id, source_sha256: "c".repeat(64) };
    vi.spyOn(f.database.worker, "admissionCandidates").mockReturnValue([light]);
    rememberRenderMemory(
      f.database,
      memoryProfileKey(light, f.config.image),
      407 * MIB,
      true,
    );
    vi.spyOn(admission, "readHostResources").mockReturnValue({
      availableBytes: 750 * MIB,
      memoryStallPercent: 0,
      ioStallPercent: 0,
    });
    f.processed.mockImplementation((_db, config) => {
      expect(config.containerMemoryBytes).toBe(2048 * MIB);
      f.abort.abort();
      return Promise.resolve();
    });
    await runWorker(f.database, f.config, f.abort.signal);
    expect(f.claimed).toHaveBeenCalledWith(
      f.database,
      f.config.workerId,
      undefined,
      light.id,
    );
    expect(f.failed).not.toHaveBeenCalled();
  });
  it("does not use a small prediction to bypass severe host memory pressure", async () => {
    const f = fixture();
    f.config.minimumAvailableMemoryBytes = 500 * MIB;
    const candidate = {
      id: job.id,
      user_id: "owner",
      source_sha256: "b".repeat(64),
      entrypoint: "main.tex",
      engine: "lualatex" as const,
      outputs_json: '["pdf"]',
      queued_at: new Date().toISOString(),
    };
    vi.spyOn(f.database.worker, "admissionCandidates").mockReturnValue([
      candidate,
    ]);
    rememberRenderMemory(
      f.database,
      memoryProfileKey(candidate, f.config.image),
      191 * MIB,
      true,
    );
    vi.spyOn(admission, "readHostResources").mockReturnValue({
      availableBytes: 750 * MIB,
      memoryStallPercent: 15,
      ioStallPercent: 0,
    });
    await runWorker(f.database, f.config, f.abort.signal, {
      idleDelay: () => {
        f.abort.abort();
        return Promise.resolve();
      },
    });
    expect(f.claimed).not.toHaveBeenCalled();
    expect(f.failed).not.toHaveBeenCalled();
  });
  it("keeps low-memory jobs queued without launching a renderer", async () => {
    const f = fixture();
    f.config.minimumAvailableMemoryBytes = 1024;
    vi.spyOn(admission, "readHostResources").mockReturnValue({
      availableBytes: 512,
      memoryStallPercent: 0,
      ioStallPercent: 0,
    });
    vi.spyOn(f.database.worker, "nextQueued").mockReturnValue({
      id: job.id,
      queued_at: new Date().toISOString(),
    });
    await runWorker(f.database, f.config, f.abort.signal, {
      idleDelay: () => {
        f.abort.abort();
        return Promise.resolve();
      },
    });
    expect(f.claimed).not.toHaveBeenCalled();
    expect(f.processed).not.toHaveBeenCalled();
    expect(f.database.settings.value("worker_admission", null)).toMatchObject({
      state: "memory_low",
    });
  });
  it("does not fail a resource-blocked job when its long-wait notice becomes due", async () => {
    const f = fixture();
    f.config.minimumAvailableMemoryBytes = 1024;
    f.config.admissionWaitTimeoutMs = 1000;
    vi.spyOn(admission, "readHostResources").mockReturnValue({
      availableBytes: 512,
      memoryStallPercent: 0,
      ioStallPercent: 0,
    });
    vi.spyOn(f.database.worker, "nextQueued").mockReturnValue({
      id: job.id,
      queued_at: new Date(Date.now() - 2000).toISOString(),
    });
    await runWorker(f.database, f.config, f.abort.signal, {
      idleDelay: () => {
        f.abort.abort();
        return Promise.resolve();
      },
    });
    expect(f.processed).not.toHaveBeenCalled();
    expect(f.claimed).not.toHaveBeenCalled();
    expect(f.failed).not.toHaveBeenCalled();
  });
  it("does not claim another job or finish shutdown before the active render completes", async () => {
    const f = fixture();
    let ready!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => {
        ready = resolve;
      }),
      active = new Promise<void>((resolve) => {
        finish = resolve;
      });
    f.processed.mockImplementation(async () => {
      ready();
      await active;
    });
    const run = runWorker(f.database, f.config, f.abort.signal);
    await started;
    f.abort.abort();
    expect(f.stopped).not.toHaveBeenCalled();
    expect(f.claimed).toHaveBeenCalledOnce();
    finish();
    await run;
    expect(f.stopped).toHaveBeenCalledOnce();
    expect(f.claimed).toHaveBeenCalledOnce();
    expect(f.failed).not.toHaveBeenCalled();
  });
  it("does not claim after a stop arriving during startup recovery", async () => {
    const f = fixture();
    f.recover.mockImplementation(() => {
      f.abort.abort();
      return Promise.resolve();
    });
    await runWorker(f.database, f.config, f.abort.signal);
    expect(f.claimed).not.toHaveBeenCalled();
    expect(f.stopped).toHaveBeenCalledOnce();
  });
  it("keeps unknown container state out of failure publication and pauses new claims", async () => {
    const f = fixture();
    f.processed.mockRejectedValue(
      new docker.RendererCleanupDeferred("unavailable"),
    );
    vi.spyOn(f.database.worker, "runtimeState").mockReturnValue({
      status: "running",
      lease_owner: f.config.workerId,
      lease_generation: 1,
      cancel_requested_at: null,
    });
    let waits = 0;
    await runWorker(f.database, f.config, f.abort.signal, {
      idleDelay: () => {
        waits++;
        f.abort.abort();
        return Promise.resolve();
      },
    });
    expect(waits).toBe(1);
    expect(f.claimed).toHaveBeenCalledOnce();
    expect(f.failed).not.toHaveBeenCalled();
  });
  it("waits for the previous worker's still-valid attempt until periodic recovery settles it", async () => {
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const f = fixture();
    f.database.settings.upsert(
      "worker_heartbeat",
      { workerId: "previous" },
      "fixture",
      new Date(now).toISOString(),
    );
    vi.spyOn(f.database.worker, "ownedActiveJobIds").mockReturnValue([job.id]);
    let status = "running";
    vi.spyOn(f.database.worker, "runtimeState").mockImplementation(() => ({
      status,
      lease_owner: "previous",
      lease_generation: 1,
      cancel_requested_at: null,
    }));
    f.recover.mockImplementation(() => {
      if (f.recover.mock.calls.length > 1) status = "queued";
      return Promise.resolve();
    });
    f.claimed.mockImplementation(() => {
      expect(status).toBe("queued");
      return job;
    });
    f.processed.mockImplementation(() => {
      f.abort.abort();
      return Promise.resolve();
    });
    await runWorker(f.database, f.config, f.abort.signal, {
      idleDelay: () => {
        expect(f.claimed).not.toHaveBeenCalled();
        now += 10_000;
        return Promise.resolve();
      },
    });
    expect(f.recover).toHaveBeenCalledTimes(2);
    expect(f.claimed).toHaveBeenCalledOnce();
    expect(f.stopped).toHaveBeenCalledOnce();
  });
});
