import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { RendererJobsService } from "../apps/renderer-api/src/services/jobs.js";
import {
  jobResponseSchema,
  type JobStatus,
} from "../packages/contracts/src/index.js";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("renderer job status artifacts", () => {
  it("describes downloadable artifacts, previews, and the retention deadline", () => {
    const database = seededDatabase();
    const jobId = "job_11111111111111111111111111111111";
    seedJob(database, jobId, "succeeded", "2026-08-10T03:00:00.000Z");
    seedArtifact(database, jobId, "pdf", "result.pdf", 1200, "a");
    seedArtifact(database, jobId, "log", "compile.log", 300, "b");
    seedArtifact(database, jobId, "errors", "errors.json", 100, "c");
    seedArtifact(
      database,
      jobId,
      "svg",
      "svg/objects/math-000001.svg",
      200,
      "f",
    );
    seedArtifact(database, jobId, "preview", "previews/page-1.png", 800, "d");

    const response = service(database).status(jobId);

    expect(jobResponseSchema.parse(response)).toEqual(response);
    expect(response.retentionExpiresAt).toBe("2026-08-11T03:00:00.000Z");
    expect(response.artifacts).toEqual([
      artifact(
        "log",
        "compile.log",
        300,
        "b",
        `/api/v1/jobs/${jobId}/artifacts/compile.log`,
      ),
      artifact(
        "errors",
        "errors.json",
        100,
        "c",
        `/api/v1/jobs/${jobId}/artifacts/errors.json`,
      ),
      artifact(
        "pdf",
        "result.pdf",
        1200,
        "a",
        `/api/v1/jobs/${jobId}/artifacts/result.pdf`,
      ),
      artifact(
        "svg",
        "svg/objects/math-000001.svg",
        200,
        "f",
        `/api/v1/jobs/${jobId}/artifacts/svg/objects/math-000001.svg`,
      ),
    ]);
    expect(response.previews).toEqual([
      artifact(
        "preview",
        "previews/page-1.png",
        800,
        "d",
        `/api/v1/jobs/${jobId}/previews/page-1.png`,
      ),
    ]);
  });

  it.each(["failed", "expired"] as const)(
    "returns a deadline and empty collections for a %s job without outputs",
    (status) => {
      const database = seededDatabase();
      const jobId =
        status === "failed"
          ? "job_22222222222222222222222222222222"
          : "job_33333333333333333333333333333333";
      seedJob(database, jobId, status, "2026-08-10T04:30:00.000Z");

      expect(service(database).status(jobId)).toMatchObject({
        status,
        retentionExpiresAt: "2026-08-11T04:30:00.000Z",
        artifacts: [],
        previews: [],
      });
    },
  );

  it("leaves retention unset while a job is active", () => {
    const database = seededDatabase();
    const jobId = "job_44444444444444444444444444444444";
    seedJob(database, jobId, "running", null);

    expect(service(database).status(jobId)).toMatchObject({
      status: "running",
      retentionExpiresAt: null,
      artifacts: [],
      previews: [],
    });
  });

  it("does not advertise artifacts once deletion has started", () => {
    const database = seededDatabase();
    const jobId = "job_55555555555555555555555555555555";
    seedJob(database, jobId, "deleting", "2026-08-10T05:00:00.000Z");
    seedArtifact(database, jobId, "pdf", "result.pdf", 1200, "e");

    expect(service(database).status(jobId)).toMatchObject({
      status: "deleting",
      retentionExpiresAt: null,
      artifacts: [],
      previews: [],
    });
  });
});

function service(database: RendererDatabase): RendererJobsService {
  return new RendererJobsService({
    database,
    tickets: {} as never,
    storageRoot: "/nonexistent",
    maxUploadBytes: 1,
    minFreeStorageBytes: 1,
    artifactRetentionHours: 24,
  });
}

function seededDatabase(): RendererDatabase {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const timestamp = "2026-08-10T00:00:00.000Z";
  database.raw
    .prepare(
      `INSERT INTO users
    (id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at)
    VALUES ('user_status','subject-status','status@example.test','Status','user','active',1,'test',?,?)`,
    )
    .run(timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO service_accounts
    (id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
    VALUES ('sa_status','user_status','status','generic','active',1,?,?)`,
    )
    .run(timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO api_keys
    (id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
    VALUES ('key_status','sa_status','status','lrk_status','hash','v1','["render:create"]',?,'test')`,
    )
    .run(timestamp);
  return database;
}

function seedJob(
  database: RendererDatabase,
  id: string,
  status: JobStatus,
  completedAt: string | null,
): void {
  const updatedAt = completedAt ?? "2026-08-10T02:00:00.000Z";
  database.raw
    .prepare(
      `INSERT INTO jobs
    (id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at,completed_at,error_code,error_message)
    VALUES (?,'user_status','sa_status','key_status',?,'test',10,?,'2026-08-10T01:00:00.000Z',?,?,?,?)`,
    )
    .run(
      id,
      status,
      "0".repeat(64),
      updatedAt,
      completedAt,
      status === "failed" ? "LATEX_COMPILE_FAILED" : null,
      status === "failed" ? "Compilation failed" : null,
    );
}

function seedArtifact(
  database: RendererDatabase,
  jobId: string,
  type: string,
  relativePath: string,
  size: number,
  hashCharacter: string,
): void {
  database.artifacts.insert({
    id: `artifact_${hashCharacter.repeat(8)}`,
    job_id: jobId,
    type,
    relative_path: relativePath,
    size,
    sha256: hashCharacter.repeat(64),
    created_at: "2026-08-10T03:00:00.000Z",
  });
}

function artifact(
  type: string,
  relativePath: string,
  size: number,
  hashCharacter: string,
  downloadUrl: string,
): Record<string, unknown> {
  return {
    type,
    relativePath,
    size,
    sha256: hashCharacter.repeat(64),
    createdAt: "2026-08-10T03:00:00.000Z",
    downloadUrl,
  };
}
