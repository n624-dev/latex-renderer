import { afterEach, describe, it, expect, vi } from "vitest";
import { RendererDatabase, type WorkerJobRow } from "@latex-renderer/database";
import { DEFAULT_RESOURCE_LIMITS } from "@latex-renderer/shared";
import type { WorkerConfig } from "../apps/renderer-worker/src/config.js";
import * as docker from "../apps/renderer-worker/src/docker.js";
import * as recovery from "../apps/renderer-worker/src/recovery.js";
import * as heartbeat from "../apps/renderer-worker/src/heartbeat.js";
import * as processor from "../apps/renderer-worker/src/job-processor.js";
import * as failure from "../apps/renderer-worker/src/failure.js";
import * as queue from "../apps/renderer-worker/src/queue.js";
import * as admission from "../apps/renderer-worker/src/admission.js";
import { runWorker } from "../apps/renderer-worker/src/worker.js";

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
  it("finishes a resource-blocked job at its queue deadline without rendering it", async () => {
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
    expect(f.failed).toHaveBeenCalledWith(
      f.database,
      f.config,
      job,
      expect.any(String),
      "HOST_RESOURCE_BUSY",
      "failed",
    );
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
