import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { recordFailure } from "../apps/renderer-worker/src/failure.js";
import { processJob } from "../apps/renderer-worker/src/job-processor.js";
import type { WorkerConfig } from "../apps/renderer-worker/src/config.js";
import { directorySize } from "../apps/renderer-worker/src/artifact-validator.js";

const databases: RendererDatabase[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const root of temporaryRoots.splice(0))
    await rm(root, { recursive: true, force: true });
});

describe("renderer transient workspace cleanup", () => {
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
    const output = join(root, "jobs", jobId, "output"),
      artifacts = database.artifacts.listDownloadable(jobId),
      total = artifacts.reduce((sum, artifact) => sum + artifact.size, 0);
    expect(database.jobs.get(jobId)?.output_size).toBe(total);
    await expect(directorySize(output)).resolves.toBe(total);
  });
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
