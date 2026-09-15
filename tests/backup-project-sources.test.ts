import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";

const roots: string[] = [];
const ageAvailable = ["age", "age-keygen"].every(
  (command) =>
    spawnSync(command, ["--version"], { stdio: "ignore" }).status === 0,
);
// These systemd host scripts intentionally use Linux descriptor-relative opens.
const linuxDescriptorAccess =
  process.platform === "linux" && existsSync("/proc/self/fd");
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

describe.runIf(ageAvailable && linuxDescriptorAccess)(
  "Project Source backup boundary",
  () => {
    it("includes migrated job-backed Sources alongside current Sources, without duplicating revisions' archives", () => {
      const fixture = backupFixture();
      const legacyId = `source_${"4".repeat(32)}`;
      const key = `jobs/job_${"4".repeat(32)}/input/source.zip`;
      const legacyPath = join(fixture.storageRoot, key);
      mkdirSync(join(legacyPath, ".."), { recursive: true });
      writeFileSync(legacyPath, readFileSync(fixture.sourcePath));
      const database = new RendererDatabase(fixture.databasePath);
      try {
        database.raw
          .prepare(
            `INSERT INTO sources
        (id,owner_user_id,size,sha256,storage_key,status,created_at,updated_at,expires_at,uploaded_at,paths_json)
        SELECT ?,owner_user_id,size,sha256,?,status,created_at,updated_at,expires_at,uploaded_at,paths_json FROM sources WHERE id=?`,
          )
          .run(legacyId, key, fixture.sourceId);
        for (const [index, sourceId, entrypoint] of [
          [0, legacyId, "main.tex"],
          [1, fixture.sourceId, "second.tex"],
        ] as const) {
          database.projects.insertRevision({
            id: `revision_${String(index + 5).repeat(32)}`,
            projectId: fixture.projectId,
            sourceId,
            displayName: `Revision ${index + 2}`,
            originalFilename: entrypoint,
            entrypoint,
            timestamp: new Date().toISOString(),
          });
        }
      } finally {
        database.close();
      }
      const backup = runBackup(fixture);
      expect(backup.status, backup.stderr).toBe(0);
      expect(JSON.parse(backup.stdout)).toMatchObject({
        projectSourceCount: 2,
        projectRevisionCount: 3,
      });
      rmSync(fixture.storageRoot, { recursive: true, force: true });
      const restored = runRestore(fixture, backupArchive(fixture));
      expect(restored.status, restored.stderr).toBe(0);
      expect(JSON.parse(restored.stdout)).toMatchObject({
        projectSourceCount: 2,
        projectRevisionCount: 3,
      });
    }, 20_000);

    it.each(["sources", "projects"])(
      "rejects a snapshot with a missing referenced %s row before producing an archive",
      (table) => {
        const fixture = backupFixture();
        const database = new DatabaseSync(fixture.databasePath);
        try {
          database.exec(`PRAGMA foreign_keys=OFF; DELETE FROM ${table}`);
        } finally {
          database.close();
        }
        const backup = runBackup(fixture);
        expect(backup.status).not.toBe(0);
        expect(backup.stderr).toContain("foreign_key_check");
        expect(readdirSync(fixture.backupDirectory)).toEqual([]);
      },
    );

    it("rejects database CHECK corruption before producing an archive", () => {
      const fixture = backupFixture();
      updateDatabase(
        fixture,
        "PRAGMA ignore_check_constraints=ON; UPDATE sources SET size=-1",
      );
      const backup = runBackup(fixture);
      expect(backup.status).not.toBe(0);
      expect(backup.stderr).toContain("integrity_check");
      expect(readdirSync(fixture.backupDirectory)).toEqual([]);
    });

    it.each([1, 2])(
      "rejects foreign key corruption even when a format %i archive has a matching DB digest",
      (format) => {
        const fixture = backupFixture();
        const backup = runBackup(fixture);
        expect(backup.status, backup.stderr).toBe(0);
        const work = decryptBackup(fixture);
        const database = new DatabaseSync(join(work, "renderer.sqlite3"));
        try {
          database.exec("PRAGMA foreign_keys=OFF; DELETE FROM sources");
        } finally {
          database.close();
        }
        const manifest = readManifest(work);
        manifest.format = format;
        manifest.database.size = readFileSync(
          join(work, "renderer.sqlite3"),
        ).length;
        manifest.database.sha256 = createHash("sha256")
          .update(readFileSync(join(work, "renderer.sqlite3")))
          .digest("hex");
        manifest.projectSources.sources = [];
        writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest));
        const restored = runRestore(fixture, encryptBackup(fixture, work));
        expect(restored.status).not.toBe(0);
        expect(restored.stderr).toContain("foreign_key_check");
      },
    );

    it.each([1, 2])(
      "rejects CHECK corruption in a format %i archive despite a matching DB digest",
      (format) => {
        const fixture = backupFixture();
        expect(runBackup(fixture).status).toBe(0);
        const work = decryptBackup(fixture);
        const database = new DatabaseSync(join(work, "renderer.sqlite3"));
        try {
          database.exec(
            "PRAGMA ignore_check_constraints=ON; UPDATE sources SET size=-1",
          );
        } finally {
          database.close();
        }
        const manifest = readManifest(work);
        manifest.format = format;
        const bytes = readFileSync(join(work, "renderer.sqlite3"));
        manifest.database = {
          size: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        };
        writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest));
        const restored = runRestore(fixture, encryptBackup(fixture, work));
        expect(restored.status).not.toBe(0);
        expect(restored.stderr).toContain("integrity_check");
      },
    );

    it("validates a private DB without changing its bytes or leaving journals", () => {
      const fixture = backupFixture();
      const bytes = readFileSync(fixture.databasePath);
      const files = readdirSync(fixture.root).sort();
      runCommand(process.execPath, [
        "--input-type=module",
        "-e",
        `
      import { DatabaseSync } from "node:sqlite";
      import { assertBackupDatabase } from "./deploy/scripts/backup-boundary.mjs";
      const database = new DatabaseSync(process.argv[1]);
      try { assertBackupDatabase(database); } finally { database.close(); }
    `,
        fixture.databasePath,
      ]);
      expect(readFileSync(fixture.databasePath)).toEqual(bytes);
      expect(readdirSync(fixture.root).sort()).toEqual(files);
    });

    it("keeps the legacy format-1 database-only restore boundary", () => {
      const fixture = backupFixture();
      expect(runBackup(fixture).status).toBe(0);
      const work = decryptBackup(fixture);
      const manifest = readManifest(work);
      manifest.format = 1;
      Reflect.deleteProperty(manifest, "projectSources");
      writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest));
      rmSync(join(work, "project-sources"), { recursive: true });
      const result = runRestore(fixture, encryptBackup(fixture, work));
      expect(result.status, result.stderr).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        projectSourceCount: 0,
      });
    });

    it("excludes deleted Projects and generated Job artifacts from the periodic backup", () => {
      const fixture = backupFixture();
      updateDatabase(
        fixture,
        "UPDATE projects SET deleted_at='2026-01-01T00:00:00.000Z'",
      );
      rmSync(fixture.sourcePath);
      mkdirSync(join(fixture.storageRoot, "jobs", "irrelevant", "output"), {
        recursive: true,
      });
      writeFileSync(
        join(fixture.storageRoot, "jobs", "irrelevant", "output", "render.pdf"),
        "excluded generated artifact",
      );
      const backup = runBackup(fixture);
      expect(backup.status, backup.stderr).toBe(0);
      expect(JSON.parse(backup.stdout)).toMatchObject({
        projectSourceCount: 0,
        projectRevisionCount: 0,
      });
      const work = decryptBackup(fixture);
      expect(readdirSync(work).sort()).toEqual([
        "manifest.json",
        "renderer.sqlite3",
      ]);
      expect(readManifest(work)).toMatchObject({ artifactsIncluded: false });
      expect(runRestore(fixture, backupArchive(fixture)).status).toBe(0);
    });

    it.each(["file", "parent", "legacy-parent", "storage-root"])(
      "rejects a %s symlink instead of reading outside the storage root",
      (kind) => {
        const fixture = backupFixture();
        let target = fixture.sourcePath;
        if (kind === "parent") target = join(fixture.sourcePath, "..");
        if (kind === "storage-root") target = fixture.storageRoot;
        if (kind === "legacy-parent") {
          const key = `jobs/job_${"1".repeat(32)}/input/source.zip`;
          const legacy = join(fixture.storageRoot, key);
          mkdirSync(join(legacy, ".."), { recursive: true });
          renameSync(fixture.sourcePath, legacy);
          updateDatabase(fixture, `UPDATE sources SET storage_key='${key}'`);
          target = join(legacy, "..");
        }
        const outside = join(fixture.root, "outside");
        renameSync(target, outside);
        symlinkSync(outside, target);
        const backup = runBackup(fixture);
        expect(backup.status).not.toBe(0);
        expect(backup.stderr).toContain("Could not back up Project Source");
        expect(readdirSync(fixture.backupDirectory)).toEqual([]);
        expect(existsSync(outside)).toBe(true);
      },
    );

    it.each(["hardlink", "fifo"])(
      "rejects a %s Project Source without hanging or producing an archive",
      (kind) => {
        const fixture = backupFixture();
        if (kind === "hardlink")
          linkSync(fixture.sourcePath, join(fixture.root, "other-link"));
        else {
          rmSync(fixture.sourcePath);
          runCommand("mkfifo", [fixture.sourcePath]);
        }
        const backup = runBackup(fixture);
        expect(backup.status).not.toBe(0);
        expect(backup.stderr).toContain("single-link regular file");
        expect(readdirSync(fixture.backupDirectory)).toEqual([]);
      },
    );

    it.runIf(process.getuid?.() !== 0)(
      "fails closed when a Project Source is unreadable",
      () => {
        const fixture = backupFixture();
        chmodSync(fixture.sourcePath, 0o000);
        const backup = runBackup(fixture);
        expect(backup.status).not.toBe(0);
        expect(backup.stderr).toContain("EACCES");
        expect(readdirSync(fixture.backupDirectory)).toEqual([]);
      },
    );

    it.each([
      "../outside.zip",
      "/etc/passwd",
      `sources/source_${"2".repeat(32)}/source.zip`,
      `jobs/job_${"2".repeat(32)}/input/source.zip`,
      `jobs/job_${"1".repeat(32)}/input/../source.zip`,
    ])("rejects an unsupported Project Source storage key: %s", (key) => {
      const fixture = backupFixture();
      updateDatabase(fixture, `UPDATE sources SET storage_key='${key}'`);
      const backup = runBackup(fixture);
      expect(backup.status).not.toBe(0);
      expect(backup.stderr).toContain("storage key is invalid");
      expect(readdirSync(fixture.backupDirectory)).toEqual([]);
    });

    it("rejects an invalid Source ID without allowing the revision join to hide it", () => {
      const fixture = backupFixture();
      updateDatabase(
        fixture,
        "PRAGMA foreign_keys=OFF; UPDATE sources SET id='../outside'; UPDATE project_revisions SET source_id='../outside'",
      );
      const backup = runBackup(fixture);
      expect(backup.status).not.toBe(0);
      expect(backup.stderr).toContain("metadata is invalid");
    });

    it.each(["size", "checksum", "metadata"])(
      "rejects a Project Source %s mismatch",
      (kind) => {
        const fixture = backupFixture();
        if (kind === "size")
          updateDatabase(fixture, "UPDATE sources SET size=size+1");
        else if (kind === "metadata")
          updateDatabase(
            fixture,
            `UPDATE sources SET sha256='${"z".repeat(64)}'`,
          );
        else
          writeFileSync(
            fixture.sourcePath,
            Buffer.alloc(readFileSync(fixture.sourcePath).length, 42),
          );
        const backup = runBackup(fixture);
        expect(backup.status).not.toBe(0);
        expect(backup.stderr).toMatch(/does not match|metadata is invalid/);
        expect(readdirSync(fixture.backupDirectory)).toEqual([]);
      },
    );

    it.each(["missing-file", "checksum", "source-mapping", "revision-mapping"])(
      "rejects an incomplete or inconsistent restore: %s",
      (kind) => {
        const fixture = backupFixture();
        expect(runBackup(fixture).status).toBe(0);
        const work = decryptBackup(fixture);
        const source = join(
          work,
          "project-sources",
          fixture.sourceId,
          "source.zip",
        );
        if (kind === "missing-file") rmSync(source);
        else if (kind === "checksum")
          writeFileSync(source, Buffer.alloc(readFileSync(source).length, 42));
        else {
          const manifest = readManifest(work);
          if (kind === "source-mapping") manifest.projectSources.sources = [];
          else manifest.projectSources.revisions = [];
          writeFileSync(join(work, "manifest.json"), JSON.stringify(manifest));
        }
        const restored = runRestore(fixture, encryptBackup(fixture, work));
        expect(restored.status).not.toBe(0);
        expect(restored.stderr).not.toContain("restore_test.completed");
      },
    );

    it.each([
      "file-symlink",
      "parent-symlink",
      "hardlink",
      "traversal",
      "absolute",
      "duplicate",
      "unexpected-file",
    ])("rejects %s archive entries before extraction", (kind) => {
      const fixture = backupFixture();
      expect(runBackup(fixture).status).toBe(0);
      const work = decryptBackup(fixture);
      const source = join(
        work,
        "project-sources",
        fixture.sourceId,
        "source.zip",
      );
      const outside = join(fixture.root, "outside");
      if (kind === "file-symlink" || kind === "parent-symlink") {
        const original = kind === "file-symlink" ? source : join(source, "..");
        renameSync(original, outside);
        symlinkSync(outside, original);
      } else if (kind === "hardlink") {
        rmSync(source);
        linkSync(join(work, "renderer.sqlite3"), source);
      } else if (kind === "unexpected-file")
        writeFileSync(join(work, "extra-secret"), "excluded");
      const transform =
        kind === "traversal"
          ? ["--transform=s,^manifest.json$,../escaped-backup-manifest.json,"]
          : kind === "absolute"
            ? ["--transform=s,^manifest.json$,/escaped-backup-manifest.json,"]
            : [];
      const restored = runRestore(
        fixture,
        encryptBackup(
          fixture,
          work,
          transform,
          kind === "duplicate" ? ["manifest.json"] : [],
        ),
      );
      expect(restored.status).not.toBe(0);
      expect(restored.stderr).toContain("unsafe or duplicate entry");
      if (kind.includes("symlink")) expect(existsSync(outside)).toBe(true);
    });

    it.each(["backup", "restore"])(
      "enforces the same archive listing limit before %s can report success",
      (operation) => {
        const fixture = backupFixture();
        let archive = "";
        if (operation === "restore") {
          expect(runBackup(fixture).status).toBe(0);
          archive = backupArchive(fixture);
        }
        // Stream a listing over the limit; no large Source/file fixture is created.
        const bin = join(fixture.root, "bin");
        mkdirSync(bin);
        const resolvedTar = spawnSync("/bin/sh", ["-c", "command -v tar"], {
          encoding: "utf8",
        });
        expect(resolvedTar.status, resolvedTar.stderr).toBe(0);
        writeFileSync(
          join(bin, "tar"),
          `#!${process.execPath}
const { writeSync } = require("node:fs");
const { spawnSync } = require("node:child_process");
if (process.argv.includes("-tf") || process.argv.includes("-tvf")) {
  const chunk = Buffer.alloc(65536, 120);
  for (let i = 0; i < 257; i += 1) {
    let offset = 0;
    while (offset < chunk.length) offset += writeSync(1, chunk, offset, chunk.length - offset);
  }
} else {
  const result = spawnSync(${JSON.stringify(resolvedTar.stdout.trim())}, process.argv.slice(2), { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
`,
          { mode: 0o700 },
        );
        const environment = { PATH: `${bin}:${process.env.PATH ?? ""}` };
        const result =
          operation === "backup"
            ? runBackup(fixture, environment)
            : runRestore(fixture, archive, environment);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          "Backup archive listing exceeds its size limit",
        );
        expect(result.stdout).not.toContain(".completed");
        if (operation === "backup")
          expect(readdirSync(fixture.backupDirectory)).toEqual([]);
      },
    );

    it("backs up and restore-tests every Source referenced by an active Project revision", () => {
      const fixture = backupFixture();
      const originalDatabase = readFileSync(fixture.databasePath);
      const backup = runBackup(fixture);
      expect(backup.status, backup.stderr).toBe(0);
      expect(readFileSync(fixture.databasePath)).toEqual(originalDatabase);
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
  },
);

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
    root,
    databasePath,
    storageRoot,
    backupDirectory,
    identity,
    recipient,
    sourcePath,
    sourceId,
    projectId,
  };
}

function runBackup(
  fixture: ReturnType<typeof backupFixture>,
  environment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(process.execPath, ["deploy/scripts/backup.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      ...environment,
      DATABASE_PATH: fixture.databasePath,
      STORAGE_ROOT: fixture.storageRoot,
      BACKUP_DIRECTORY: fixture.backupDirectory,
      BACKUP_AGE_RECIPIENT_FILE: fixture.recipient,
      BACKUP_UPLOAD_EXECUTABLE: "",
    },
  });
}

function backupArchive(fixture: ReturnType<typeof backupFixture>) {
  return join(
    fixture.backupDirectory,
    readdirSync(fixture.backupDirectory).find((name) =>
      name.endsWith(".age"),
    ) ?? "missing.age",
  );
}

function runRestore(
  fixture: ReturnType<typeof backupFixture>,
  archive: string,
  environment: NodeJS.ProcessEnv = {},
) {
  return spawnSync(
    process.execPath,
    ["deploy/scripts/restore-test.mjs", archive],
    {
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        ...environment,
        BACKUP_AGE_IDENTITY_FILE: fixture.identity,
      },
    },
  );
}

function decryptBackup(fixture: ReturnType<typeof backupFixture>) {
  const work = join(fixture.root, "decrypted");
  mkdirSync(work);
  runCommand("age", [
    "-d",
    "-i",
    fixture.identity,
    "-o",
    join(work, "backup.tar"),
    backupArchive(fixture),
  ]);
  runCommand("tar", ["-C", work, "-xf", join(work, "backup.tar")]);
  rmSync(join(work, "backup.tar"));
  return work;
}

function encryptBackup(
  fixture: ReturnType<typeof backupFixture>,
  work: string,
  options: string[] = [],
  extraEntries: string[] = [],
) {
  const tar = join(fixture.root, "changed.tar");
  const archive = join(fixture.root, "changed.tar.age");
  const entries = readdirSync(work);
  runCommand("tar", [
    "-C",
    work,
    ...options,
    "-cf",
    tar,
    ...entries,
    ...extraEntries,
  ]);
  runCommand("age", ["-R", fixture.recipient, "-o", archive, tar]);
  return archive;
}

function runCommand(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
}

interface BackupManifest {
  format: number;
  database: { size: number; sha256: string };
  projectSources: { sources: unknown[]; revisions: unknown[] };
}

function readManifest(work: string) {
  return JSON.parse(
    readFileSync(join(work, "manifest.json"), "utf8"),
  ) as BackupManifest;
}

function updateDatabase(
  fixture: ReturnType<typeof backupFixture>,
  sql: string,
) {
  const database = new DatabaseSync(fixture.databasePath);
  try {
    database.exec(sql);
  } finally {
    database.close();
  }
}
