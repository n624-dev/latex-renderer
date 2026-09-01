#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const archive = process.argv[2];
if (!archive) throw new Error("usage: restore-test.mjs BACKUP.tar.age");
const identity = required("BACKUP_AGE_IDENTITY_FILE");
const work = await mkdtemp(join(tmpdir(), "latex-restore-test-"));

try {
  const tarPath = join(work, "backup.tar");
  await run("age", ["-d", "-i", identity, "-o", tarPath, archive]);
  await run("tar", [
    "-C",
    work,
    "--no-same-owner",
    "--no-same-permissions",
    "-xf",
    tarPath,
  ]);
  const manifest = JSON.parse(
    await readFile(join(work, "manifest.json"), "utf8"),
  );
  if (manifest.format !== 1 && manifest.format !== 2)
    throw new Error("Backup manifest format is unsupported");
  const databasePath = join(work, "renderer.sqlite3");
  const info = await stat(databasePath);
  if (
    info.size !== manifest.database?.size ||
    (await sha256(databasePath)) !== manifest.database?.sha256
  )
    throw new Error("Backup database manifest mismatch");

  const database = new DatabaseSync(databasePath, { readOnly: true });
  let migrations;
  try {
    const integrity = database.prepare("PRAGMA integrity_check").all();
    migrations = database
      .prepare(
        "SELECT version,applied_at FROM schema_migrations ORDER BY version",
      )
      .all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
      throw new Error("SQLite integrity_check failed");
    if (manifest.format === 2)
      await verifyProjectSources(database, manifest.projectSources);
  } finally {
    database.close();
  }
  console.log(
    JSON.stringify({
      event: "restore_test.completed",
      migrations,
      projectSourceCount: manifest.projectSources?.sources?.length ?? 0,
      projectRevisionCount: manifest.projectSources?.revisions?.length ?? 0,
    }),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}

async function verifyProjectSources(database, boundary) {
  if (
    boundary?.included !== true ||
    boundary.directory !== "project-sources" ||
    !Array.isArray(boundary.sources) ||
    !Array.isArray(boundary.revisions)
  )
    throw new Error("Project Source backup manifest is invalid");
  const expectedSources = database
    .prepare(
      `SELECT DISTINCT s.id,s.size,s.sha256
       FROM sources s
       JOIN project_revisions r ON r.source_id=s.id
       JOIN projects p ON p.id=r.project_id
       WHERE p.deleted_at IS NULL
       ORDER BY s.id`,
    )
    .all();
  if (boundary.sources.length !== expectedSources.length)
    throw new Error("Project Source backup set is incomplete");
  for (let index = 0; index < expectedSources.length; index += 1) {
    const expected = expectedSources[index];
    const actual = boundary.sources[index];
    const relativePath = `project-sources/${expected.id}/source.zip`;
    if (
      actual?.id !== expected.id ||
      actual?.relativePath !== relativePath ||
      actual?.size !== expected.size ||
      actual?.sha256 !== expected.sha256
    )
      throw new Error("Project Source manifest does not match the database");
    const path = join(work, relativePath);
    const file = await lstat(path);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.nlink !== 1 ||
      file.size !== expected.size ||
      (await sha256(path)) !== expected.sha256
    )
      throw new Error(`Project Source backup file is invalid: ${expected.id}`);
  }
  const expectedRevisions = database
    .prepare(
      `SELECT r.id AS revisionId,r.project_id AS projectId,r.source_id AS sourceId
       FROM project_revisions r
       JOIN projects p ON p.id=r.project_id
       WHERE p.deleted_at IS NULL
       ORDER BY r.project_id,r.revision_number,r.id`,
    )
    .all();
  if (JSON.stringify(boundary.revisions) !== JSON.stringify(expectedRevisions))
    throw new Error("Project revision mapping does not match the database");
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });
    let error = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (error.length < 8192) error += chunk;
    });
    child.once("error", reject);
    child.once("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} failed: ${error}`)),
    );
  });
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
