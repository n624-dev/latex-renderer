import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererDatabase, SvgRetryOperations } from "@latex-renderer/database";
import { readFileSync } from "node:fs";
import { outputStagesV21Sql } from "../packages/database/src/schema.js";
const databases: RendererDatabase[] = [];
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-19T01:00:00.000Z"));
});
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  vi.useRealTimers();
});
const now = "2026-10-19T00:00:00.000Z",
  id = `job_${"7".repeat(32)}`;
function fixture() {
  const db = new RendererDatabase(":memory:");
  databases.push(db);
  db.migrate();
  db.raw
    .exec(`INSERT INTO users(id,email,display_name,role,status,security_version,created_by,created_at,updated_at)
    VALUES('user','stage@example.test','Stage','user','active',1,'test','${now}','${now}');
    INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
    VALUES('sa','user','stage','ci','active',1,'${now}','${now}');
    INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by)
    VALUES('key','sa','stage','stage','hash','v1','[]','${now}','test');`);
  db.sources.insertReserved({
    id: "source",
    ownerUserId: "user",
    size: 10,
    sha256: "b".repeat(64),
    storageKey: "sources/source/source.zip",
    timestamp: now,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  db.raw.exec(
    "UPDATE sources SET status='ready',paths_json='[\"main.tex\"]' WHERE id='source'",
  );
  db.jobs.insertQueued({
    id,
    userId: "user",
    serviceAccountId: "sa",
    apiKeyId: "key",
    rendererVersion: "test",
    sourceId: "source",
    entrypoint: "main.tex",
    outputs: ["pdf", "svg"],
    timestamp: now,
    reservedOutputBytes: 100,
  });
  db.worker.claimNext("worker", now, "2099-01-01T00:00:00.000Z");
  expect(
    db.outputStages.initialize(id, "worker", 1, `sha256:${"e".repeat(64)}`),
  ).toBe(true);
  db.worker.transitionOwned(id, "worker", 1, ["validating"], "running", now);
  return db;
}
function pdf(db: RendererDatabase) {
  expect(db.outputStages.start(id, "pdf", "worker", 1)).toBe(true);
  expect(
    db.outputStages.completePdf(id, "worker", 1, {
      storageGeneration: 2,
      sha256: "a".repeat(64),
      synctexSha256: "c".repeat(64),
      synctexBytes: 20,
      completedAt: now,
    }),
  ).toBe(true);
  db.artifacts.insert({
    id: "artifact_pdf",
    job_id: id,
    type: "pdf",
    relative_path: "result.pdf",
    storage_generation: 2,
    size: 10,
    sha256: "a".repeat(64),
    created_at: now,
  });
}
describe("independent output checkpoints", () => {
  it("keeps deployment SQL identical to the application migration", () => {
    const sql = readFileSync(
      "deploy/migrations/021_independent_output_stages.sql",
      "utf8",
    )
      .trim()
      .replace(/^BEGIN IMMEDIATE;\n/, "")
      .replace(/\nCOMMIT;$/, "");
    expect(sql).toBe(outputStagesV21Sql.trim());
  });
  it("deduplicates SVG retry requests and enforces ownership, maintenance, quotas, and immutable bindings", () => {
    const db = fixture();
    pdf(db);
    db.worker.transitionOwned(id, "worker", 1, ["running"], "failed", now, {
      completed_at: now,
      lease_owner: null,
      lease_expires_at: null,
      output_size: 30,
    });
    const op = new SvgRetryOperations(db, { maxOutputBytes: 100 }),
      actor = {
        type: "user",
        id: "actor",
        userId: "user",
        serviceAccountId: "sa",
      },
      key = "retry-key-123456789";
    expect(() => op.retry({ ...actor, userId: "other" }, id, key)).toThrow(
      /Job does not exist/,
    );
    expect(() =>
      op.retry({ ...actor, serviceAccountId: "other" }, id, key),
    ).toThrow(/Job does not exist/);
    db.settings.upsert("maintenance_mode", "reject-new-jobs", "test", now);
    expect(() => op.retry(actor, id, key)).toThrow(/temporarily unavailable/);
    db.settings.upsert("maintenance_mode", "normal", "test", now);
    db.settings.upsert("max_user_storage_bytes", 1, "test", now);
    expect(() => op.retry(actor, id, key)).toThrow(/quota/);
    db.settings.upsert("max_user_storage_bytes", 10000, "test", now);
    db.raw.prepare("UPDATE jobs SET entrypoint='other.tex' WHERE id=?").run(id);
    expect(() => op.retry(actor, id, key)).toThrow(/requires/);
    db.raw.prepare("UPDATE jobs SET entrypoint='main.tex' WHERE id=?").run(id);
    expect(op.retry(actor, id, key)).toEqual({ id, reused: false });
    expect(op.retry(actor, id, key)).toEqual({ id, reused: true });
    expect(db.outputStages.publicState(id)?.svg.attempt).toBe(2);
  });
  it("migrates idempotently and fences stale PDF publication", () => {
    const db = fixture();
    db.migrate();
    expect(db.outputStages.start(id, "pdf", "other", 1)).toBe(false);
    expect(db.outputStages.start(id, "pdf", "worker", 1)).toBe(true);
    expect(
      db.outputStages.completePdf(id, "other", 1, {
        storageGeneration: 2,
        sha256: "a".repeat(64),
        synctexSha256: "c".repeat(64),
        synctexBytes: 20,
        completedAt: now,
      }),
    ).toBe(false);
    expect(db.outputStages.publicState(id)?.pdf.status).toBe("running");
  });
  it.each(["failed", "timeout", "canceled"] as const)(
    "keeps a completed PDF when SVG is %s",
    (status) => {
      const db = fixture();
      pdf(db);
      expect(db.outputStages.start(id, "svg", "worker", 1)).toBe(true);
      db.worker.transitionOwned(id, "worker", 1, ["running"], status, now, {
        completed_at: now,
        lease_owner: null,
        lease_expires_at: null,
        error_code: "SVG_ERROR",
      });
      expect(db.outputStages.publicState(id)).toMatchObject({
        pdf: { status: "succeeded", sha256: "a".repeat(64) },
        svg: { status, errorCode: "SVG_ERROR" },
      });
    },
  );
  it("retries SVG on the same Job without replacing or extending the PDF checkpoint", () => {
    const db = fixture();
    pdf(db);
    db.worker.transitionOwned(id, "worker", 1, ["running"], "failed", now, {
      completed_at: now,
      lease_owner: null,
      lease_expires_at: null,
    });
    expect(
      db.transaction(() =>
        db.outputStages.requeueSvg(
          id,
          "other",
          now,
          "2026-10-18T00:00:00.000Z",
          100,
        ),
      ),
    ).toBe(false);
    expect(
      db.transaction(() =>
        db.outputStages.requeueSvg(
          id,
          "user",
          now,
          "2026-10-18T00:00:00.000Z",
          100,
        ),
      ),
    ).toBe(true);
    expect(db.outputStages.publicState(id)).toMatchObject({
      pdf: { status: "succeeded", completedAt: now, sha256: "a".repeat(64) },
      svg: { status: "queued", attempt: 2 },
    });
    expect(
      db.transaction(() =>
        db.outputStages.requeueSvg(
          id,
          "user",
          now,
          "2026-10-18T00:00:00.000Z",
          100,
        ),
      ),
    ).toBe(false);
  });
  it("rejects expired PDFs, exhausted attempts, and modified Sources", () => {
    const db = fixture();
    pdf(db);
    db.worker.transitionOwned(id, "worker", 1, ["running"], "failed", now, {
      completed_at: now,
      lease_owner: null,
      lease_expires_at: null,
    });
    expect(
      db.transaction(() =>
        db.outputStages.requeueSvg(id, "user", now, now, 100),
      ),
    ).toBe(false);
    db.raw.exec("UPDATE job_output_stages SET svg_attempt=8");
    expect(
      db.transaction(() =>
        db.outputStages.requeueSvg(
          id,
          "user",
          now,
          "2026-10-18T00:00:00.000Z",
          100,
        ),
      ),
    ).toBe(false);
    db.raw.exec(
      "UPDATE job_output_stages SET svg_attempt=1;UPDATE sources SET sha256='" +
        "c".repeat(64) +
        "'",
    );
    expect(
      db.transaction(() =>
        db.outputStages.requeueSvg(
          id,
          "user",
          now,
          "2026-10-18T00:00:00.000Z",
          100,
        ),
      ),
    ).toBe(false);
  });
  it("retries a retained temporary Job after its Source orphan deadline without extending PDF retention", () => {
    const db = fixture();
    pdf(db);
    db.worker.transitionOwned(id, "worker", 1, ["running"], "failed", now, {
      completed_at: now,
      lease_owner: null,
      lease_expires_at: null,
    });
    const expired = "2026-10-19T00:30:00.000Z";
    db.raw
      .prepare("UPDATE sources SET expires_at=? WHERE id='source'")
      .run(expired);
    expect(
      db.sources.getReady("source", "2026-10-19T01:30:00.000Z"),
    ).toBeDefined();
    const checkpoint = db.outputStages.checkpoint(id);
    expect(
      db.transaction(() =>
        db.outputStages.requeueSvg(
          id,
          "user",
          "2026-10-19T01:30:00.000Z",
          "2026-10-18T01:30:00.000Z",
          100,
        ),
      ),
    ).toBe(true);
    expect(db.outputStages.checkpoint(id)).toMatchObject({
      pdf_sha256: checkpoint?.pdf_sha256,
      pdf_generation: checkpoint?.pdf_generation,
      pdf_completed_at: now,
      svg_status: "queued",
    });
    expect(
      db.raw.prepare("SELECT expires_at FROM sources WHERE id='source'").get(),
    ).toMatchObject({ expires_at: expired });
  });

  it.each(["deleting", "deleted"])(
    "does not revive a %s Source for SVG retry",
    (status) => {
      const db = fixture();
      pdf(db);
      db.worker.transitionOwned(id, "worker", 1, ["running"], "failed", now, {
        completed_at: now,
        lease_owner: null,
        lease_expires_at: null,
      });
      db.raw
        .prepare("UPDATE sources SET status=?,expires_at=? WHERE id='source'")
        .run(status, "2026-10-19T00:30:00.000Z");
      expect(
        db.outputStages.requeueSvg(
          id,
          "user",
          "2026-10-19T01:30:00.000Z",
          "2026-10-18T01:30:00.000Z",
          100,
        ),
      ).toBe(false);
      expect(db.jobs.get(id)?.status).toBe("failed");
    },
  );
  it("recovery queues only unfinished stages and preserves a published PDF", () => {
    const db = fixture();
    pdf(db);
    db.outputStages.start(id, "svg", "worker", 1);
    db.raw.prepare("UPDATE jobs SET status='queued' WHERE id=?").run(id);
    expect(db.outputStages.publicState(id)).toMatchObject({
      pdf: { status: "succeeded" },
      svg: { status: "queued" },
    });
  });
  it("bounds artifact availability by the PDF's first publication and hides old SVG during retry", () => {
    const db = fixture();
    pdf(db);
    db.outputStages.start(id, "svg", "worker", 1);
    db.outputStages.completeSvg(id, "worker", 1, {
      storageGeneration: 3,
      status: "failed",
      errorCode: "SVG_ERROR",
      errorMessage: null,
      completedAt: now,
    });
    db.artifacts.publishStage({
      id: "svg_log",
      job_id: id,
      type: "log",
      relative_path: "svg/compile.log",
      storage_generation: 3,
      size: 1,
      sha256: "c".repeat(64),
      created_at: now,
    });
    db.worker.transitionOwned(id, "worker", 1, ["running"], "failed", now, {
      completed_at: now,
      lease_owner: null,
      lease_expires_at: null,
    });
    const policy = { now: Date.parse(now) + 3600000, retentionHours: 24 };
    expect(
      db.artifacts.listDownloadable(id, policy).map((a) => a.relative_path),
    ).toEqual(["result.pdf", "svg/compile.log"]);
    expect(
      db.outputStages.requeueSvg(
        id,
        "user",
        now,
        "2026-10-18T00:00:00.000Z",
        100,
      ),
    ).toBe(true);
    expect(
      db.artifacts.listDownloadable(id, policy).map((a) => a.relative_path),
    ).toEqual(["result.pdf"]);
    expect(
      db.artifacts.listDownloadable(id, {
        ...policy,
        now: Date.parse(now) + 25 * 3600000,
      }),
    ).toEqual([]);
  });
});
