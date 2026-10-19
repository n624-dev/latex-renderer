import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererDatabase, type StaleLeaseRow } from "@latex-renderer/database";
import { pruneRecoveredStageAttempt } from "../apps/renderer-worker/src/stage-recovery.js";

const resources: Array<{ db: RendererDatabase; root: string }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const { db, root } of resources.splice(0)) {
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "renderer-stage-recovery-")),
    storageRoot = join(root, "storage"),
    id = `job_${"b".repeat(32)}`;
  const db = new RendererDatabase(":memory:");
  resources.push({ db, root });
  db.migrate();
  const time = "2026-01-01T00:00:00.000Z";
  db.raw
    .exec(`INSERT INTO users(id,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES('u','recovery@example.test','Recovery','user','active',1,'test','${time}','${time}');
    INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at) VALUES('sa','u','test','ci','active',1,'${time}','${time}');
    INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES('k','sa','test','test','hash','v1','[]','${time}','test');`);
  db.sources.insertReserved({
    id: "source",
    ownerUserId: "u",
    size: 10,
    sha256: "a".repeat(64),
    storageKey: "sources/source/source.zip",
    timestamp: time,
    expiresAt: "2099-01-01T00:00:00.000Z",
  });
  db.raw.exec(
    "UPDATE sources SET status='ready',paths_json='[\"main.tex\"]' WHERE id='source'",
  );
  db.jobs.insertQueued({
    id,
    userId: "u",
    serviceAccountId: "sa",
    apiKeyId: "k",
    rendererVersion: "test",
    sourceId: "source",
    entrypoint: "main.tex",
    outputs: ["pdf", "svg"],
    timestamp: time,
    reservedOutputBytes: 100,
  });
  db.worker.claimNext("old", time, "2026-01-02T00:00:00.000Z");
  db.outputStages.initialize(id, "old", 1, `sha256:${"c".repeat(64)}`);
  db.worker.transitionOwned(id, "old", 1, ["validating"], "running", time);
  db.outputStages.start(id, "pdf", "old", 1);
  db.outputStages.completePdf(id, "old", 1, {
    storageGeneration: 2,
    sha256: "a".repeat(64),
    synctexSha256: "b".repeat(64),
    synctexBytes: 1,
    completedAt: time,
  });
  db.artifacts.insert({
    id: "artifact_pdf",
    job_id: id,
    type: "pdf",
    relative_path: "result.pdf",
    storage_generation: 2,
    size: 4,
    sha256: "a".repeat(64),
    created_at: time,
  });
  const stale: StaleLeaseRow = {
    id,
    status: "running",
    lease_owner: "old",
    lease_expires_at: "2026-01-02T00:00:00.000Z",
    lease_generation: 1,
  };
  const generation = db.worker.claimExpiredLease(
    stale,
    "recovery",
    "2026-10-19T00:00:00.000Z",
    "2099-01-01T00:00:00.000Z",
  );
  if (generation === undefined)
    throw new Error("Failed recovery fixture claim");
  const jobRoot = join(storageRoot, "jobs", id),
    attempt = join(jobRoot, "attempts", "1"),
    pdf = join(jobRoot, "outputs", "2"),
    orphan = join(jobRoot, "outputs", "3");
  for (const path of [attempt, pdf, orphan]) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "marker"), "retained");
  }
  const config = {
    storageRoot,
    maxZipEntries: 10,
    maxFileCount: 10,
    maxOutputFileCount: 10,
    maxOutputDirectoryCount: 10,
  };
  const recover = () =>
    pruneRecoveredStageAttempt(db, config, stale, "recovery", generation);
  return { db, root, jobRoot, attempt, pdf, orphan, id, recover };
}
describe.skipIf(process.platform !== "linux")(
  "staged attempt crash recovery after verified daemon stop",
  () => {
    it("removes abandoned attempts and uncommitted SVG, never the published PDF", async () => {
      const f = await fixture();
      await f.recover();
      await expect(readFile(join(f.attempt, "marker"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(readFile(join(f.orphan, "marker"))).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(join(f.pdf, "marker"), "utf8")).toBe("retained");
      await f.recover();
    });
    it("does not reclaim any directory while a download lease is active", async () => {
      const f = await fixture();
      f.db.artifacts.createLease({
        id: "transfer",
        jobId: f.id,
        artifactId: "artifact_pdf",
        createdAt: new Date().toISOString(),
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      await f.recover();
      expect(await readFile(join(f.orphan, "marker"), "utf8")).toBe("retained");
      expect(await readFile(join(f.attempt, "marker"), "utf8")).toBe(
        "retained",
      );
    });
    it("unlinks internal symlinks without visiting outside targets", async () => {
      const f = await fixture(),
        outside = join(f.root, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "sentinel"), "safe");
      await symlink(outside, join(f.attempt, "escape"));
      await f.recover();
      expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("safe");
    });
    it("rejects a symlink at the cleanup target itself", async () => {
      const f = await fixture(),
        outside = join(f.root, "outside");
      await mkdir(outside);
      await writeFile(join(outside, "sentinel"), "safe");
      await rm(f.attempt, { recursive: true });
      await symlink(outside, f.attempt);
      await expect(f.recover()).rejects.toThrow(/Unsafe recovered stage/);
      expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("safe");
    });
    it("does not delete anything after its recovery claim is lost", async () => {
      const f = await fixture();
      f.db.raw
        .prepare("UPDATE jobs SET lease_owner='replacement' WHERE id=?")
        .run(f.id);
      await f.recover();
      expect(await readFile(join(f.attempt, "marker"), "utf8")).toBe(
        "retained",
      );
      expect(await readFile(join(f.orphan, "marker"), "utf8")).toBe("retained");
    });
  },
);
