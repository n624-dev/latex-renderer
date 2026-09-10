import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RendererDatabase,
  artifactStoragePath,
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
