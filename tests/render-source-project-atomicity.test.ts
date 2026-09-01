import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("Render Source and Project atomicity", () => {
  it("refuses a queued Job after the Source leaves ready state", () => {
    const fixture = setup();
    expect(
      fixture.database.sources.markDeleting(fixture.sourceId, fixture.now),
    ).toBe(1);
    expect(insertQueued(fixture)).toBe(0);
    expect(fixture.database.jobs.get(fixture.jobId)).toBeUndefined();
  });

  it("makes a committed queued Job fence Source deletion", () => {
    const fixture = setup();
    expect(insertQueued(fixture)).toBe(1);
    expect(
      fixture.database.sources.markDeleting(fixture.sourceId, fixture.now),
    ).toBe(0);
    expect(fixture.database.sources.get(fixture.sourceId)?.status).toBe(
      "ready",
    );
  });

  it("never reassigns an existing Job to a different Project revision", () => {
    const fixture = setup();
    const firstProject = `project_${"2".repeat(32)}`,
      secondProject = `project_${"3".repeat(32)}`;
    for (const [id, name] of [
      [firstProject, "First"],
      [secondProject, "Second"],
    ] as const)
      fixture.database.projects.insert({
        id,
        ownerUserId: fixture.userId,
        displayName: name,
        timestamp: fixture.now,
      });
    const firstRevision = fixture.database.projects.insertRevision({
        id: `revision_${"4".repeat(32)}`,
        projectId: firstProject,
        sourceId: fixture.sourceId,
        displayName: "First revision",
        originalFilename: "source.zip",
        entrypoint: "main.tex",
        timestamp: fixture.now,
      }),
      secondRevision = fixture.database.projects.insertRevision({
        id: `revision_${"5".repeat(32)}`,
        projectId: secondProject,
        sourceId: fixture.sourceId,
        displayName: "Second revision",
        originalFilename: "source.zip",
        entrypoint: "main.tex",
        timestamp: fixture.now,
      });
    expect(insertQueued(fixture, firstRevision.id)).toBe(1);

    expect(
      fixture.database.jobs.attachProjectRevision(
        fixture.jobId,
        secondRevision.id,
      ),
    ).toBe(0);
    expect(fixture.database.jobs.get(fixture.jobId)?.project_revision_id).toBe(
      firstRevision.id,
    );
  });
});

function setup() {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const now = new Date().toISOString(),
    userId = "user_atomic",
    sourceId = `source_${"1".repeat(32)}`,
    jobId = `job_${"1".repeat(32)}`;
  database.raw
    .prepare(
      `INSERT INTO users
       (id,email,display_name,role,status,security_version,created_by,created_at,updated_at)
       VALUES (?,?,'Atomic user','user','active',1,'test',?,?)`,
    )
    .run(userId, "atomic@example.test", now, now);
  database.raw
    .prepare(
      `INSERT INTO service_accounts
       (id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
       VALUES ('sa_atomic',?,'Atomic','ci','active',1,?,?)`,
    )
    .run(userId, now, now);
  database.raw
    .prepare(
      `INSERT INTO api_keys
       (id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
       VALUES ('key_atomic','sa_atomic','Atomic','atomic','hash','v1','[]',?,'test')`,
    )
    .run(now);
  database.sources.insertReserved({
    id: sourceId,
    ownerUserId: userId,
    size: 10,
    sha256: "a".repeat(64),
    storageKey: `sources/${sourceId}/source.zip`,
    timestamp: now,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  database.raw
    .prepare(
      `UPDATE sources SET status='ready',uploaded_at=?,paths_json='["main.tex"]'
       WHERE id=?`,
    )
    .run(now, sourceId);
  return { database, now, userId, sourceId, jobId };
}

function insertQueued(
  fixture: ReturnType<typeof setup>,
  projectRevisionId?: string,
) {
  return fixture.database.jobs.insertQueued({
    id: fixture.jobId,
    userId: fixture.userId,
    serviceAccountId: "sa_atomic",
    apiKeyId: "key_atomic",
    rendererVersion: "renderer:test",
    sourceId: fixture.sourceId,
    entrypoint: "main.tex",
    timestamp: fixture.now,
    reservedOutputBytes: 0,
    ...(projectRevisionId === undefined ? {} : { projectRevisionId }),
  });
}
