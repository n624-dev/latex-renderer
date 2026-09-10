import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { spawn } from "node:child_process";
import * as docker from "../apps/renderer-worker/src/docker.js";
import yazl from "yazl";
import { pipeline } from "node:stream/promises";
import { createWriteStream, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RendererDatabase,
  artifactStoragePath,
} from "@latex-renderer/database";
import { recordFailure } from "../apps/renderer-worker/src/failure.js";
import { processJob } from "../apps/renderer-worker/src/job-processor.js";
import type { WorkerConfig } from "../apps/renderer-worker/src/config.js";
import { directorySize } from "../apps/renderer-worker/src/artifact-validator.js";

const databases: RendererDatabase[] = [];
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) database.close();
  for (const root of temporaryRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("renderer transient workspace cleanup", () => {
  it("accounts for output published just before cancellation and fences stale writers", async () => {
    const { database, config, root, jobId } = await fixture("validating");
    const input = join(root, "jobs", jobId, "input");
    await mkdir(input, { recursive: true });
    const archive = new yazl.ZipFile();
    const writing = pipeline(
      archive.outputStream,
      createWriteStream(join(input, "source.zip")),
    );
    archive.addBuffer(Buffer.from("test"), "main.tex");
    archive.end();
    await writing;
    vi.spyOn(docker, "spawnRenderer").mockImplementation(
      (_config, _id, _generation, _extracted, staging) => {
        writeFileSync(
          join(staging, "compile.log"),
          "fixture renderer failed\n",
        );
        return {
          containerName: "fixture",
          process: spawn(process.execPath, ["-e", "process.exit(1)"], {
            stdio: ["ignore", "pipe", "pipe"],
          }),
        };
      },
    );
    const { rename } =
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      );
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      await rename(from, to);
      if (to === join(root, "jobs", jobId, "outputs", "1"))
        database.raw
          .prepare("UPDATE jobs SET cancel_requested_at=? WHERE id=?")
          .run(new Date().toISOString(), jobId);
    });
    await processJob(database, config, workerJob(jobId));
    const bytes = await directorySize(
      join(root, "jobs", jobId, "outputs", "1"),
    );
    expect(bytes).toBeGreaterThan(0);
    expect(database.jobs.get(jobId)).toMatchObject({
      status: "canceled",
      output_size: bytes,
    });
    expect(
      database.worker.markCanceled(
        jobId,
        "stale-worker",
        0,
        new Date().toISOString(),
        0,
      ),
    ).toBe(0);
    expect(database.jobs.get(jobId)?.output_size).toBe(bytes);
  });
  it("removes extracted work and staging when ZIP validation fails", async () => {
    const { database, config, root, jobId } = await fixture("validating");
    const input = join(root, "jobs", jobId, "input");
    await mkdir(input, { recursive: true });
    await writeFile(join(input, "source.zip"), "not a zip");

    await expect(
      processJob(database, config, {
        id: jobId,
        source_size: 9,
        source_sha256: "0".repeat(64),
        status: "validating",
        source_id: null,
        source_storage_key: null,
        entrypoint: "main.tex",
        outputs_json: '["pdf"]',
        lease_generation: 1,
      }),
    ).rejects.toThrow();

    await expect(pathExists(join(root, "jobs", jobId, "work"))).resolves.toBe(
      false,
    );
    await expect(
      pathExists(join(root, "jobs", jobId, "staging")),
    ).resolves.toBe(false);
  });

  it("does not retain failure artifacts after a concurrent cancellation", async () => {
    const { database, config, root, jobId } = await fixture("canceled");

    await recordFailure(
      database,
      config,
      workerJob(jobId),
      "validation stopped after cancellation",
      "RENDERER_FAILED",
      "failed",
    );

    expect(database.jobs.get(jobId)?.status).toBe("canceled");
    expect(database.artifacts.listDownloadable(jobId)).toEqual([]);
    await expect(pathExists(join(root, "jobs", jobId, "output"))).resolves.toBe(
      false,
    );
  });

  it("records failure output_size as the exact published artifact total", async () => {
    const { database, config, root, jobId } = await fixture("validating");
    await recordFailure(
      database,
      config,
      workerJob(jobId),
      "source validation failed",
      "ZIP_INVALID",
      "rejected",
    );
    const output = join(root, "jobs", jobId, "outputs", "1"),
      artifacts = database.artifacts.listDownloadable(jobId),
      total = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
    expect(database.jobs.get(jobId)?.output_size).toBe(total);
    await expect(directorySize(output)).resolves.toBe(total);
  });

  it("removes its uncommitted output if the final DB transaction rolls back", async () => {
    const { database, config, root, jobId } = await fixture("validating");
    const legacy = join(root, "jobs", jobId, "output");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "compile.log"), "legacy stays intact");
    vi.spyOn(database, "audit").mockImplementation(() => {
      throw new Error("fixture DB rollback");
    });
    await expect(
      recordFailure(
        database,
        config,
        workerJob(jobId),
        "failure",
        "FAILED",
        "failed",
      ),
    ).rejects.toThrow("fixture DB rollback");
    expect(database.artifacts.listDownloadable(jobId)).toEqual([]);
    expect(database.jobs.get(jobId)?.status).toBe("validating");
    expect(await pathExists(join(root, "jobs", jobId, "outputs", "1"))).toBe(
      false,
    );
    expect(await fs.readFile(join(legacy, "compile.log"), "utf8")).toBe(
      "legacy stays intact",
    );
  });

  it.each([false, true])(
    "a stale writer cannot replace a newer published generation (failure=%s)",
    async (failure) => {
      const { database, config, root, jobId } = await fixture("validating");
      const input = join(root, "jobs", jobId, "input");
      await mkdir(input, { recursive: true });
      const zip = new yazl.ZipFile();
      const writing = pipeline(
        zip.outputStream,
        createWriteStream(join(input, "source.zip")),
      );
      zip.addBuffer(Buffer.from("test"), "main.tex");
      zip.end();
      await writing;
      vi.spyOn(docker, "spawnRenderer").mockImplementation(
        (_config, _id, generation, _extracted, staging) => {
          writeFileSync(
            join(staging, "compile.log"),
            `generation ${generation}\n`,
          );
          return {
            containerName: "fixture",
            process: spawn(process.execPath, ["-e", "process.exit(1)"], {
              stdio: ["ignore", "pipe", "pipe"],
            }),
          };
        },
      );
      const { rename } =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      let resume!: () => void, paused!: () => void;
      const gate = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const reached = new Promise<void>((resolve) => {
        paused = resolve;
      });
      vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
        if (
          from ===
          join(
            root,
            "jobs",
            jobId,
            "attempts",
            failure ? "1-failure" : "1",
            "output",
          )
        ) {
          paused();
          await gate;
        }
        await rename(from, to);
      });
      const old = failure
        ? recordFailure(
            database,
            config,
            workerJob(jobId),
            "old failure",
            "FAILED",
            "failed",
          )
        : processJob(database, config, workerJob(jobId));
      try {
        await reached;
        database.raw
          .prepare(
            "UPDATE jobs SET lease_generation=2,lease_owner='worker_new',status='validating' WHERE id=?",
          )
          .run(jobId);
        await processJob(
          database,
          { ...config, workerId: "worker_new" },
          { ...workerJob(jobId), lease_generation: 2 },
        );
        const row = database.artifacts.getDownloadable(jobId, "compile.log")!;
        expect(row.storage_generation).toBe(2);
        expect(await fs.readFile(artifactStoragePath(root, row), "utf8")).toBe(
          "generation 2\n",
        );
        resume();
        await old;
        expect(
          database.artifacts.getDownloadable(jobId, "compile.log"),
        ).toEqual(row);
        expect(await fs.readFile(artifactStoragePath(root, row), "utf8")).toBe(
          "generation 2\n",
        );
        expect(
          await pathExists(join(root, "jobs", jobId, "outputs", "1")),
        ).toBe(false);
      } finally {
        resume();
        await old;
      }
    },
  );
});

async function fixture(status: "validating" | "canceled"): Promise<{
  database: RendererDatabase;
  config: WorkerConfig;
  root: string;
  jobId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "latex-worker-cleanup-"));
  temporaryRoots.push(root);
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const timestamp = "2026-08-11T00:00:00.000Z";
  const jobId = `job_${"a".repeat(32)}`;
  database.raw
    .prepare(
      `INSERT INTO users
      (id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
      VALUES ('user','subject','user@example.test','User','user','active',1,'test',?,?)`,
    )
    .run(timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO service_accounts
      (id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
      VALUES ('service','user','Service','generic','active',1,?,?)`,
    )
    .run(timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO api_keys
      (id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
      VALUES ('key','service','Key','prefix','hash','v1','["render:create"]',?,'test')`,
    )
    .run(timestamp);
  database.raw
    .prepare(
      `INSERT INTO jobs
      (id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at,lease_owner,lease_generation)
      VALUES (?,'user','service','key',?,'renderer',9,?,?,?,'worker_test',1)`,
    )
    .run(jobId, status, "0".repeat(64), timestamp, timestamp);
  return {
    database,
    root,
    jobId,
    config: {
      databasePath: ":memory:",
      storageRoot: root,
      image: `sha256:${"0".repeat(64)}`,
      workerId: "worker_test",
      seccompProfile: "/nonexistent/seccomp.json",
      apparmorProfile: undefined,
      maxUploadBytes: 20 * 1024 * 1024,
      maxExtractedBytes: 100 * 1024 * 1024,
      maxFileCount: 500,
      maxZipEntries: 1_000,
      maxOutputBytes: 200 * 1024 * 1024,
      maxOutputFileCount: 2_000,
      maxOutputDirectoryCount: 200,
      maxLogBytes: 10 * 1024 * 1024,
      maxSvgObjects: 200,
      maxSvgBytes: 10 * 1024 * 1024,
      maxSvgTotalBytes: 100 * 1024 * 1024,
      svgConversionTimeoutSeconds: 120,
      containerUid: 10_000,
      containerGid: 10_000,
      jobTimeoutMs: 420_000,
    },
  };
}

function workerJob(jobId: string) {
  return {
    id: jobId,
    source_size: 9,
    source_sha256: "0".repeat(64),
    status: "validating",
    source_id: null,
    source_storage_key: null,
    entrypoint: "main.tex",
    outputs_json: '["pdf"]',
    lease_generation: 1,
  };
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}
