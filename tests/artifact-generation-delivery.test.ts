import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RendererDatabase,
  artifactStoragePath,
  bindArtifactDownloadLeases,
} from "@latex-renderer/database";
import {
  adminArtifactsArchiveResponse,
  adminArtifactResponse,
} from "../apps/admin-api/src/services/artifacts.js";
import { artifactResponse } from "../apps/renderer-api/src/services/artifacts.js";
import type {
  AdminDependencies,
  AppActor,
} from "../apps/admin-api/src/types.js";
import type { RendererApiDependencies } from "../apps/renderer-api/src/types.js";
import yazl from "yazl";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});
const jobId = `job_${"a".repeat(32)}`;
const actor: AppActor = {
  type: "user",
  id: "user",
  userId: "user",
  role: "owner",
};

async function fixture(generation: number | null = 2) {
  const root = await mkdtemp(join(tmpdir(), "artifact-generation-"));
  const database = new RendererDatabase(":memory:");
  cleanups.push(async () => {
    database.close();
    await rm(root, { recursive: true, force: true });
  });
  database.migrate();
  const now = new Date().toISOString();
  database.raw
    .prepare(
      "INSERT INTO users(id,email,display_name,role,status,created_by,created_at,updated_at) VALUES ('user','fixture@example.invalid','fixture','owner','active','test',?,?)",
    )
    .run(now, now);
  database.raw
    .prepare(
      "INSERT INTO service_accounts(id,owner_user_id,name,client_type,created_at,updated_at) VALUES ('sa','user','fixture','generic',?,?)",
    )
    .run(now, now);
  database.raw
    .prepare(
      "INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES ('key','sa','fixture','lrk_test','hash','v1','[]',?,'test')",
    )
    .run(now);
  database.raw
    .prepare(
      "INSERT INTO jobs(id,user_id,service_account_id,api_key_id,status,renderer_version,source_size,source_sha256,created_at,updated_at,completed_at) VALUES (?,'user','sa','key','succeeded','fixture',1,?,?,?,?)",
    )
    .run(jobId, "0".repeat(64), now, now, now);
  const row = {
    id: "artifact_test",
    job_id: jobId,
    type: "log",
    relative_path: "compile.log",
    size: 8,
    sha256: "a".repeat(64),
    created_at: now,
    storage_generation: generation,
  };
  database.artifacts.insert(row);
  const path = artifactStoragePath(root, row);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "selected");
  const deps = { database, storageRoot: root, artifactRetentionHours: 24 };
  return {
    root,
    database,
    path,
    row,
    admin: deps as AdminDependencies,
    renderer: deps as RendererApiDependencies,
  };
}

describe("generation-selected artifact delivery", () => {
  it.each(["missing", "expired", "database-error"])("aborts rather than silently reacquiring a %s lease", async reason => {
    const f = await fixture(), stream = new PassThrough(), errors: Error[] = [];
    stream.on("error", error => errors.push(error));
    f.database.artifacts.createLease({ id: "lease", jobId, artifactId: f.row.id, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300_000).toISOString() });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const release = bindArtifactDownloadLeases(f.database.artifacts, ["lease"], stream);
    if (reason === "missing") f.database.artifacts.deleteLease("lease");
    else if (reason === "expired") f.database.raw.prepare("UPDATE artifact_download_leases SET expires_at=?").run(new Date(Date.now()).toISOString());
    else vi.spyOn(f.database.artifacts, "renewLease").mockImplementation(() => { throw new Error("database unavailable"); });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stream.destroyed).toBe(true);
    expect(errors).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    release();release();
    expect(f.database.raw.prepare("SELECT COUNT(*) AS n FROM artifact_download_leases").get()).toMatchObject({ n: 0 });
  });
  it.each(["renderer", "admin"])("releases the %s lease when the HTTP client cancels", async kind => {
    const f = await fixture();
    const response = kind === "renderer" ? artifactResponse(f.renderer, jobId, "compile.log") : adminArtifactResponse(f.admin, actor, jobId, "compile.log", false, false);
    expect(f.database.raw.prepare("SELECT COUNT(*) AS n FROM artifact_download_leases").get()).toMatchObject({ n: 1 });
    await response.body?.cancel();
    // Cancellation can precede async fs.open completion. Wait for actual close,
    // keeping the DB alive until the stream's release handler has run.
    await vi.waitFor(() => expect(f.database.raw.prepare("SELECT COUNT(*) AS n FROM artifact_download_leases").get()).toMatchObject({ n: 0 }));
  });
  it("keeps every ZIP lease alive beyond five minutes until a later file is read", async () => {
    const f = await fixture(), slow = new PassThrough();
    f.database.artifacts.insert({ ...f.row, id: "later", type: "errors", relative_path: "errors.json", size: 2 });
    await writeFile(join(dirname(f.path), "errors.json"), "{}");
    // eslint-disable-next-line @typescript-eslint/unbound-method -- the original is called with the intercepted ZipFile as this below
    const add = yazl.ZipFile.prototype.addFile;
    vi.spyOn(yazl.ZipFile.prototype, "addFile").mockImplementation(function (this: yazl.ZipFile, path, name, options) {
      if (name === "compile.log") this.addReadStream(slow, name, { compress: false, size: 8 });
      else add.call(this, path, name, options);
    });
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const response = adminArtifactsArchiveResponse(f.admin, actor, jobId), bytes = response.arrayBuffer();
    await vi.advanceTimersByTimeAsync(360_000);
    const now = new Date(Date.now()).toISOString();
    expect(f.database.raw.prepare("SELECT COUNT(*) AS n FROM artifact_download_leases WHERE expires_at>?").get(now)).toMatchObject({ n: 2 });
    // The same protection predicate used by GC still excludes this Job.
    expect(f.database.raw.prepare("SELECT id FROM jobs WHERE id=? AND NOT EXISTS (SELECT 1 FROM artifact_download_leases WHERE job_id=jobs.id AND expires_at>?)").all(jobId, now)).toEqual([]);
    slow.end("selected");
    const zip = Buffer.from(await bytes);
    expect(zip.includes(Buffer.from("selected"))).toBe(true);
    expect(zip.includes(Buffer.from("{}"))).toBe(true);
    expect(f.database.raw.prepare("SELECT COUNT(*) AS n FROM artifact_download_leases").get()).toMatchObject({ n: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("applies the retention boundary to repository, Renderer and Admin delivery", async () => {
    const f = await fixture(), deadline = Date.parse(f.row.created_at) + 24 * 3_600_000;
    const clock = vi.spyOn(Date, "now");
    clock.mockReturnValue(deadline - 1);
    expect(f.database.artifacts.listDownloadable(jobId)).toHaveLength(1);
    expect(await artifactResponse(f.renderer, jobId, "compile.log").text()).toBe("selected");
    clock.mockReturnValue(deadline);
    expect(f.database.artifacts.listDownloadable(jobId)).toEqual([]);
    expect(f.database.artifacts.getDownloadable(jobId, "compile.log")).toBeUndefined();
    expect(() => artifactResponse(f.renderer, jobId, "compile.log")).toThrow();
    expect(() => adminArtifactResponse(f.admin, actor, jobId, "compile.log", false, false)).toThrow();
    expect(() => adminArtifactsArchiveResponse(f.admin, actor, jobId)).toThrow();
    expect(await readFile(f.path, "utf8")).toBe("selected");
  });

  it("honors non-default retention and never revives expired or unfinished Jobs", async () => {
    const f = await fixture(), now = Date.parse(f.row.created_at) + 25 * 3_600_000;
    expect(f.database.artifacts.listDownloadable(jobId, { now, retentionHours: 48 })).toHaveLength(1);
    expect(f.database.artifacts.listDownloadable(jobId, { now, retentionHours: 24 })).toHaveLength(0);
    for (const status of ["expired", "deleting", "deleted", "running", "queued"]) {
      f.database.raw.prepare("UPDATE jobs SET status=? WHERE id=?").run(status, jobId);
      expect(f.database.artifacts.listDownloadable(jobId, { now, retentionHours: 48 })).toHaveLength(0);
    }
  });
  it.each([null, 2])(
    "serves legacy or selected generation without changing public names (%s)",
    async (generation) => {
      const f = await fixture(generation);
      if (generation !== null) {
        const legacy = join(f.root, "jobs", jobId, "output");
        await mkdir(legacy, { recursive: true });
        await writeFile(join(legacy, "compile.log"), "wrong old output");
      }
      expect(
        await artifactResponse(f.renderer, jobId, "compile.log").text(),
      ).toBe("selected");
      expect(
        await adminArtifactResponse(
          f.admin,
          actor,
          jobId,
          "compile.log",
          false,
          false,
        ).text(),
      ).toBe("selected");
      const archive = Buffer.from(
        await adminArtifactsArchiveResponse(
          f.admin,
          actor,
          jobId,
        ).arrayBuffer(),
      );
      expect(archive.includes(Buffer.from("selected"))).toBe(true);
      expect(archive.includes(Buffer.from("wrong old output"))).toBe(false);
      expect(
        f.database.raw
          .prepare("SELECT count(*) AS n FROM artifact_download_leases")
          .get(),
      ).toMatchObject({ n: 0 });
    },
  );

  it("propagates a real yazl stat error and releases every lease exactly once", async () => {
    const f = await fixture();
    f.database.artifacts.insert({
      ...f.row,
      id: "artifact_second",
      relative_path: "errors.json",
      type: "errors",
    });
    await writeFile(join(dirname(f.path), "errors.json"), "{}");
    await rm(f.path);
    const release = vi.spyOn(f.database.artifacts, "deleteLease");
    const response = adminArtifactsArchiveResponse(f.admin, actor, jobId);
    await expect(response.arrayBuffer()).rejects.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    expect(release).toHaveBeenCalledTimes(2);
    expect(new Set(release.mock.calls.map((call) => call[0])).size).toBe(2);
    expect(
      f.database.raw
        .prepare("SELECT count(*) AS n FROM artifact_download_leases")
        .get(),
    ).toMatchObject({ n: 0 });
    expect(f.database.jobs.get(jobId)?.status).toBe("succeeded");
  });

  it("also releases leases when archive construction throws synchronously", async () => {
    const f = await fixture();
    vi.spyOn(yazl.ZipFile.prototype, "addFile").mockImplementation(() => {
      throw new Error("fixture archive failure");
    });
    expect(() => adminArtifactsArchiveResponse(f.admin, actor, jobId)).toThrow(
      "fixture archive failure",
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(
      f.database.raw
        .prepare("SELECT count(*) AS n FROM artifact_download_leases")
        .get(),
    ).toMatchObject({ n: 0 });
  });

  it.each(["runtime", "deployment"])(
    "migrates existing artifact rows without moving old data (%s)",
    async (mode) => {
      const f = await fixture(null);
      f.database.raw.exec(
        "ALTER TABLE artifacts DROP COLUMN storage_generation; DELETE FROM schema_migrations WHERE version=17",
      );
      if (mode === "runtime") f.database.migrate();
      else
        f.database.raw.exec(
          await readFile(
            "deploy/migrations/017_artifact_generation.sql",
            "utf8",
          ),
        );
      f.database.migrate();
      const row = f.database.artifacts.getDownloadable(jobId, "compile.log");
      if (row === undefined) throw new Error("Migrated artifact is missing");
      expect(row.storage_generation).toBeNull();
      expect(await readFile(artifactStoragePath(f.root, row), "utf8")).toBe(
        "selected",
      );
      expect(
        f.database.raw.prepare("PRAGMA integrity_check").get(),
      ).toMatchObject({ integrity_check: "ok" });
      expect(f.database.raw.prepare("PRAGMA foreign_key_check").all()).toEqual(
        [],
      );
    },
  );

  it("rejects corrupt generation and traversal metadata instead of guessing", () => {
    for (const generation of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() =>
        artifactStoragePath("/unused", {
          job_id: jobId,
          relative_path: "compile.log",
          storage_generation: generation,
        }),
      ).toThrow();
    for (const relative of [
      "../secret",
      "/secret",
      "a/../secret",
      "a\\secret",
      "a//b",
    ])
      expect(() =>
        artifactStoragePath("/unused", {
          job_id: jobId,
          relative_path: relative,
        }),
      ).toThrow();
  });
});
