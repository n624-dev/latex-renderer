import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";

const databases: RendererDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("Worker lease fencing", () => {
  it("pages through a bounded admission window without losing the rest of the queue", () => {
    const f = setup(),
      original = f.database.jobs.get(f.jobId);
    if (!original?.source_id) throw new Error("Missing fixture Source");
    for (let i = 0; i < 32; i++)
      f.database.jobs.insertQueued({
        id: `job_extra_${i.toString().padStart(2, "0")}`,
        userId: original.user_id,
        serviceAccountId: original.service_account_id,
        apiKeyId: original.api_key_id,
        rendererVersion: original.renderer_version,
        sourceId: original.source_id,
        entrypoint: original.entrypoint,
        timestamp: "2026-08-31T00:00:00.000Z",
        reservedOutputBytes: 0,
      });
    const first = f.database.worker.admissionCandidates();
    expect(first).toHaveLength(32);
    const second = f.database.worker.admissionCandidates(first.at(-1));
    expect(second).toHaveLength(1);
    expect(new Set([...first, ...second].map((r) => r.id)).size).toBe(33);
  });
  it("claims only the selected queued ID and does not fall back after cancellation", () => {
    const f = setup(),
      now = "2026-08-31T00:00:00.000Z";
    expect(
      f.database.worker.claimNext("worker", now, now, undefined, "job_missing"),
    ).toBeUndefined();
    expect(f.database.jobs.get(f.jobId)?.status).toBe("queued");
    f.database.jobs.cancel(f.jobId, now);
    expect(
      f.database.worker.claimNext("worker", now, now, undefined, f.jobId),
    ).toBeUndefined();
  });
  it("updates only the selected Job's wait reason, without needless repeated writes", () => {
    const f = setup(),
      now = "2026-08-31T00:00:00.000Z";
    f.database.worker.setAdmissionReason(true, now, "job_missing", "waiting");
    expect(f.database.jobs.get(f.jobId)?.error_code).toBeNull();
    f.database.worker.setAdmissionReason(true, now, f.jobId, "memory low");
    f.database.worker.setAdmissionReason(
      true,
      "2026-08-31T01:00:00.000Z",
      f.jobId,
      "memory low",
    );
    expect(f.database.jobs.get(f.jobId)).toMatchObject({
      status: "queued",
      error_code: "HOST_RESOURCE_WAIT",
      error_message: "memory low",
      updated_at: now,
    });
  });
  it("recovers an expired canceled lease without requeueing it or releasing a replacement owner's lease", () => {
    const { database, jobId } = setup();
    const now = "2026-08-31T00:00:00.000Z";
    database.worker.claimNext("old", now, "2026-08-31T00:00:30.000Z");
    database.jobs.cancel(jobId, now);
    expect(database.worker.ownedActiveJobIds("old")).toEqual([jobId]);
    const stale = database.worker.staleLeases("2026-08-31T00:00:31.000Z")[0];
    if (!stale) throw new Error("Canceled lease was not recovered");
    expect(stale.status).toBe("canceled");
    const generation = database.worker.claimExpiredLease(
      stale,
      "recovery",
      "2026-08-31T00:00:31.000Z",
      "2026-08-31T00:05:31.000Z",
    );
    expect(generation).toBe(2);
    expect(database.worker.markCanceled(jobId, "old", 1, now)).toBe(0);
    expect(database.worker.expireRecoveryClaim(jobId, "recovery", 2, now)).toBe(
      1,
    );
    expect(database.worker.markCanceled(jobId, "recovery", 2, now)).toBe(1);
    expect(database.worker.runtimeState(jobId)).toMatchObject({
      status: "canceled",
      lease_owner: null,
    });
    expect(database.worker.staleLeases("2099-01-01T00:00:00.000Z")).toEqual([]);
  });
  it("publishes a bounded wait reason, does not claim a newer head at a stale deadline, and clears the reason on start", () => {
    const f = setup();
    f.database.worker.setAdmissionReason(true, "2026-08-31T00:00:00.000Z");
    expect(f.database.jobs.get(f.jobId)?.error_code).toBe("HOST_RESOURCE_WAIT");
    expect(
      f.database.worker.claimNext(
        "worker",
        "2026-08-31T00:00:00.000Z",
        "2026-08-31T00:00:30.000Z",
        "2000-01-01T00:00:00.000Z",
      ),
    ).toBeUndefined();
    expect(f.database.jobs.get(f.jobId)?.status).toBe("queued");
    expect(
      f.database.worker.claimNext(
        "worker",
        "2026-08-31T00:00:00.000Z",
        "2026-08-31T00:00:30.000Z",
      ),
    ).toBeDefined();
    expect(f.database.jobs.get(f.jobId)?.error_code).toBeNull();
    expect(f.database.jobs.get(f.jobId)?.error_message).toBeNull();
  });
  it("tracks unfinished jobs across worker restart without treating SQL wildcard characters as another owner", () => {
    const f = setup();
    f.database.worker.claimNext(
      "worker_a",
      "2026-08-31T00:00:00.000Z",
      "2026-08-31T00:00:30.000Z",
    );
    expect(f.database.worker.ownedActiveJobIds("worker_a")).toEqual([f.jobId]);
    expect(f.database.worker.ownedActiveJobIds("worker%a")).toEqual([]);
    f.database.raw
      .prepare("UPDATE jobs SET lease_owner=? WHERE id=?")
      .run("worker_a:recovery:2", f.jobId);
    expect(f.database.worker.ownedActiveJobIds("worker_a")).toEqual([f.jobId]);
    expect(f.database.worker.ownedActiveJobIds("worker")).toEqual([]);
  });
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
