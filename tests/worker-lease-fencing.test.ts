import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("Worker lease fencing", () => {
  it("does not claim or stop a lease that heartbeat renewed after stale selection", () => {
    const fixture = setup(),
      claimed = fixture.database.worker.claimNext(
        "worker-a",
        "2026-08-31T00:00:00.000Z",
        "2026-08-31T00:00:30.000Z",
      );
    expect(claimed?.lease_generation).toBe(1);
    const stale = fixture.database.worker.staleLeases(
      "2026-08-31T00:00:31.000Z",
    )[0];
    if (stale === undefined) throw new Error("expected an expired lease");

    expect(
      fixture.database.worker.heartbeat(
        fixture.jobId,
        "worker-a",
        1,
        "2026-08-31T00:00:31.000Z",
        "2026-08-31T00:01:01.000Z",
      ),
    ).toBe(1);
    expect(
      fixture.database.worker.claimExpiredLease(
        stale,
        "worker-recovery",
        "2026-08-31T00:00:31.000Z",
        "2026-08-31T00:05:31.000Z",
      ),
    ).toBeUndefined();
    expect(fixture.database.jobs.get(fixture.jobId)).toMatchObject({
      status: "validating",
      lease_owner: "worker-a",
      lease_generation: 1,
      lease_expires_at: "2026-08-31T00:01:01.000Z",
    });
  });

  it("fences the old Worker before recovery and increments every new claim", () => {
    const fixture = setup();
    expect(
      fixture.database.worker.claimNext(
        "worker-a",
        "2026-08-31T00:00:00.000Z",
        "2026-08-31T00:00:30.000Z",
      )?.lease_generation,
    ).toBe(1);
    const stale = fixture.database.worker.staleLeases(
      "2026-08-31T00:00:31.000Z",
    )[0];
    if (stale === undefined) throw new Error("expected an expired lease");
    const recoveryGeneration = fixture.database.worker.claimExpiredLease(
      stale,
      "worker-recovery",
      "2026-08-31T00:00:31.000Z",
      "2026-08-31T00:05:31.000Z",
    );
    expect(recoveryGeneration).toBe(2);
    if (recoveryGeneration === undefined)
      throw new Error("recovery did not claim the expired lease");
    expect(
      fixture.database.worker.heartbeat(
        fixture.jobId,
        "worker-a",
        1,
        "2026-08-31T00:00:32.000Z",
        "2026-08-31T00:01:02.000Z",
      ),
    ).toBe(0);
    expect(
      fixture.database.worker.transitionOwned(
        fixture.jobId,
        "worker-a",
        1,
        ["validating"],
        "running",
        "2026-08-31T00:00:32.000Z",
      ),
    ).toBe(0);
    expect(
      fixture.database.worker.recoverQueued(
        fixture.jobId,
        "worker-recovery",
        recoveryGeneration,
        "2026-08-31T00:00:33.000Z",
      ),
    ).toBe(1);
    expect(
      fixture.database.worker.claimNext(
        "worker-b",
        "2026-08-31T00:00:34.000Z",
        "2026-08-31T00:01:04.000Z",
      )?.lease_generation,
    ).toBe(3);
  });

  it("keeps a failed container inspection fenced and immediately retryable", () => {
    const fixture = setup();
    fixture.database.worker.claimNext(
      "worker-a",
      "2026-08-31T00:00:00.000Z",
      "2026-08-31T00:00:30.000Z",
    );
    const stale = fixture.database.worker.staleLeases(
      "2026-08-31T00:00:31.000Z",
    )[0];
    if (stale === undefined) throw new Error("expected an expired lease");
    const generation = fixture.database.worker.claimExpiredLease(
      stale,
      "worker-recovery",
      "2026-08-31T00:00:31.000Z",
      "2026-08-31T00:05:31.000Z",
    );
    expect(generation).toBe(2);
    expect(
      fixture.database.worker.expireRecoveryClaim(
        fixture.jobId,
        "worker-recovery",
        2,
        "2026-08-31T00:00:32.000Z",
      ),
    ).toBe(1);
    expect(
      fixture.database.worker.staleLeases("2026-08-31T00:00:32.001Z"),
    ).toMatchObject([{ id: fixture.jobId, lease_generation: 2 }]);
  });
});

function setup() {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  const timestamp = "2026-08-31T00:00:00.000Z",
    userId = "user_worker",
    sourceId = `source_${"6".repeat(32)}`,
    jobId = `job_${"7".repeat(32)}`;
  database.raw
    .prepare(
      `INSERT INTO users
       (id,email,display_name,role,status,security_version,created_by,created_at,updated_at)
       VALUES (?,?,'Worker user','user','active',1,'test',?,?)`,
    )
    .run(userId, "worker@example.test", timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO service_accounts
       (id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
       VALUES ('sa_worker',?,'Worker','ci','active',1,?,?)`,
    )
    .run(userId, timestamp, timestamp);
  database.raw
    .prepare(
      `INSERT INTO api_keys
       (id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
       VALUES ('key_worker','sa_worker','Worker','worker','hash','v1','[]',?,'test')`,
    )
    .run(timestamp);
  database.sources.insertReserved({
    id: sourceId,
    ownerUserId: userId,
    size: 10,
    sha256: "b".repeat(64),
    storageKey: `sources/${sourceId}/source.zip`,
    timestamp,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  database.raw
    .prepare(
      `UPDATE sources SET status='ready',uploaded_at=?,paths_json='["main.tex"]'
       WHERE id=?`,
    )
    .run(timestamp, sourceId);
  expect(
    database.jobs.insertQueued({
      id: jobId,
      userId,
      serviceAccountId: "sa_worker",
      apiKeyId: "key_worker",
      rendererVersion: "renderer:test",
      sourceId,
      entrypoint: "main.tex",
      timestamp,
      reservedOutputBytes: 0,
    }),
  ).toBe(1);
  return { database, jobId };
}
