import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";

const roots: string[] = [];
const ageAvailable = ["age", "age-keygen"].every(
  (command) =>
    spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0,
);
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe.runIf(ageAvailable)("Project Source backup boundary", () => {
  it("backs up and restore-tests every Source referenced by an active Project revision", () => {
    const fixture = backupFixture();
    const backup = runBackup(fixture);
    expect(backup.status, backup.stderr).toBe(0);
    expect(JSON.parse(backup.stdout)).toMatchObject({
      event: "backup.completed",
      projectSourceCount: 1,
      projectRevisionCount: 1,
    });
    rmSync(fixture.storageRoot, { recursive: true, force: true });

    const archive = join(
      fixture.backupDirectory,
      readdirSync(fixture.backupDirectory).find((name) =>
        name.endsWith(".age"),
      ) ?? "missing.age",
    );
    const restored = spawnSync(
      process.execPath,
      ["deploy/scripts/restore-test.mjs", archive],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          BACKUP_AGE_IDENTITY_FILE: fixture.identity,
        },
      },
    );
    expect(restored.status, restored.stderr).toBe(0);
    expect(JSON.parse(restored.stdout)).toMatchObject({
      event: "restore_test.completed",
      projectSourceCount: 1,
      projectRevisionCount: 1,
    });
  }, 20_000);

  it("fails closed when an active Project Source is absent", () => {
    const fixture = backupFixture();
    rmSync(fixture.sourcePath);
    const backup = runBackup(fixture);
    expect(backup.status).not.toBe(0);
    expect(backup.stderr).toContain("Could not back up Project Source");
    expect(readdirSync(fixture.backupDirectory)).toEqual([]);
  });
});

function backupFixture() {
  const root = mkdtempSync(join(tmpdir(), "latex-backup-test-"));
  roots.push(root);
  const databasePath = join(root, "renderer.sqlite3");
  const storageRoot = join(root, "storage");
  const backupDirectory = join(root, "backups");
  const identity = join(root, "age-identity.txt");
  const recipient = join(root, "age-recipient.txt");
  const sourceId = `source_${"1".repeat(32)}`;
  const projectId = `project_${"2".repeat(32)}`;
  const revisionId = `revision_${"3".repeat(32)}`;
  const sourceBytes = Buffer.from("immutable project source archive\n");
  const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
  const sourceDirectory = join(storageRoot, "sources", sourceId);
  const sourcePath = join(sourceDirectory, "source.zip");
  mkdirSync(sourceDirectory, { recursive: true });
  mkdirSync(backupDirectory, { recursive: true });
  writeFileSync(sourcePath, sourceBytes, { mode: 0o600 });

  const database = new RendererDatabase(databasePath);
  database.migrate();
  const timestamp = new Date().toISOString();
  database.users.insertInvitation({
    id: "user_backup_owner",
    email: null,
    displayName: "Backup owner",
    role: "user",
    createdBy: "test",
    timestamp,
  });
  database.raw
    .prepare(
      `INSERT INTO sources
       (id,owner_user_id,size,sha256,storage_key,status,created_at,updated_at,expires_at,uploaded_at,paths_json)
       VALUES (?,?,?,?,?,'ready',?,?,?,?,?)`,
    )
    .run(
      sourceId,
      "user_backup_owner",
      sourceBytes.length,
      sourceDigest,
      `sources/${sourceId}/source.zip`,
      timestamp,
      timestamp,
      "2099-01-01T00:00:00.000Z",
      timestamp,
      '["main.tex"]',
    );
  database.projects.insert({
    id: projectId,
    ownerUserId: "user_backup_owner",
    displayName: "Backup project",
    timestamp,
  });
  database.projects.insertRevision({
    id: revisionId,
    projectId,
    sourceId,
    displayName: "Revision 1",
    originalFilename: "main.tex",
    entrypoint: "main.tex",
    timestamp,
  });
  database.close();

  const generated = spawnSync("age-keygen", ["-o", identity], {
    encoding: "utf8",
  });
  expect(generated.status, generated.stderr).toBe(0);
  const publicKey = spawnSync("age-keygen", ["-y", identity], {
    encoding: "utf8",
  });
  expect(publicKey.status, publicKey.stderr).toBe(0);
  writeFileSync(recipient, publicKey.stdout, { mode: 0o600 });
  return {
    databasePath,
    storageRoot,
    backupDirectory,
    identity,
    recipient,
    sourcePath,
  };
}

function runBackup(fixture: ReturnType<typeof backupFixture>) {
  return spawnSync(process.execPath, ["deploy/scripts/backup.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DATABASE_PATH: fixture.databasePath,
      STORAGE_ROOT: fixture.storageRoot,
      BACKUP_DIRECTORY: fixture.backupDirectory,
      BACKUP_AGE_RECIPIENT_FILE: fixture.recipient,
    },
  });
}
