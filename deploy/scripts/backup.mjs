#!/usr/bin/env node
import { spawn } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const databasePath = absolutePath(required("DATABASE_PATH"), "DATABASE_PATH");
const storageRoot = absolutePath(required("STORAGE_ROOT"), "STORAGE_ROOT");
const destination = absolutePath(
  required("BACKUP_DIRECTORY"),
  "BACKUP_DIRECTORY",
);
const recipientFile = absolutePath(
  required("BACKUP_AGE_RECIPIENT_FILE"),
  "BACKUP_AGE_RECIPIENT_FILE",
);

await mkdir(destination, { recursive: true, mode: 0o700 });
const work = await mkdtemp(join(tmpdir(), "latex-renderer-backup-"));
const stamp = new Date().toISOString().replaceAll(":", "-");
const snapshot = join(work, "renderer.sqlite3");

try {
  const sourceDatabase = new DatabaseSync(databasePath, { readOnly: true });
  try {
    sourceDatabase.exec("PRAGMA busy_timeout=30000");
    sourceDatabase.prepare("VACUUM INTO ?").run(snapshot);
  } finally {
    sourceDatabase.close();
  }

  const snapshotDatabase = new DatabaseSync(snapshot, { readOnly: true });
  let projectBoundary;
  try {
    projectBoundary = await copyProjectSources(snapshotDatabase);
  } finally {
    snapshotDatabase.close();
  }

  const snapshotStat = await stat(snapshot);
  const digest = await sha256(snapshot);
  const manifest = {
    format: 2,
    createdAt: new Date().toISOString(),
    database: {
      name: "renderer.sqlite3",
      size: snapshotStat.size,
      sha256: digest,
    },
    artifactsIncluded: false,
    projectSources: {
      included: true,
      directory: "project-sources",
      sources: projectBoundary.sources,
      revisions: projectBoundary.revisions,
    },
  };
  await writeFile(
    join(work, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { mode: 0o600 },
  );

  const tarPath = join(work, `latex-renderer-${stamp}.tar`);
  const entries = ["renderer.sqlite3", "manifest.json"];
  if (projectBoundary.sources.length > 0) entries.push("project-sources");
  await run("tar", ["-C", work, "-cf", tarPath, ...entries]);
  const output = join(destination, `${basename(tarPath)}.age`);
  await run("age", ["-R", recipientFile, "-o", output, tarPath]);
  if ((await stat(output)).size === 0)
    throw new Error("Encrypted backup is empty");
  await uploadIfConfigured(output);
  console.log(
    JSON.stringify({
      event: "backup.completed",
      file: output,
      projectSourceCount: projectBoundary.sources.length,
      projectRevisionCount: projectBoundary.revisions.length,
    }),
  );
} finally {
  await rm(work, { recursive: true, force: true });
}

async function copyProjectSources(database) {
  const revisions = database
    .prepare(
      `SELECT r.id AS revision_id,r.project_id,r.source_id
       FROM project_revisions r
       JOIN projects p ON p.id=r.project_id
       WHERE p.deleted_at IS NULL
       ORDER BY r.project_id,r.revision_number,r.id`,
    )
    .all();
  const sources = database
    .prepare(
      `SELECT DISTINCT s.id,s.storage_key,s.size,s.sha256
       FROM sources s
       JOIN project_revisions r ON r.source_id=s.id
       JOIN projects p ON p.id=r.project_id
       WHERE p.deleted_at IS NULL
       ORDER BY s.id`,
    )
    .all();
  const copied = [];
  for (const source of sources) {
    assertProjectSource(source);
    const relativePath = `project-sources/${source.id}/source.zip`;
    const directory = join(work, "project-sources", source.id);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const sourcePath = join(storageRoot, "sources", source.id, "source.zip");
    const destinationPath = join(work, relativePath);
    await copyVerifiedRegularFile(
      sourcePath,
      destinationPath,
      source.size,
      source.sha256,
    );
    copied.push({
      id: source.id,
      relativePath,
      size: source.size,
      sha256: source.sha256,
    });
  }
  return {
    sources: copied,
    revisions: revisions.map((revision) => ({
      revisionId: revision.revision_id,
      projectId: revision.project_id,
      sourceId: revision.source_id,
    })),
  };
}

function assertProjectSource(source) {
  if (
    !/^source_[a-f0-9]{32}$/.test(source.id) ||
    source.storage_key !== `sources/${source.id}/source.zip` ||
    !Number.isSafeInteger(source.size) ||
    source.size < 0 ||
    !/^[a-f0-9]{64}$/.test(source.sha256)
  )
    throw new Error(`Project Source metadata is invalid: ${source.id}`);
}

async function copyVerifiedRegularFile(
  sourcePath,
  destinationPath,
  expectedSize,
  expectedSha256,
) {
  let source;
  let destinationHandle;
  try {
    source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const sourceStat = await source.stat();
    if (!sourceStat.isFile() || sourceStat.nlink !== 1)
      throw new Error("Project Source must be a single-link regular file");
    if (sourceStat.size !== expectedSize)
      throw new Error(
        "Project Source size does not match the database snapshot",
      );
    destinationHandle = await open(destinationPath, "wx", 0o600);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let readPosition = 0;
    for (;;) {
      const { bytesRead } = await source.read(
        buffer,
        0,
        buffer.length,
        readPosition,
      );
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(
          buffer,
          written,
          bytesRead - written,
          readPosition + written,
        );
        written += result.bytesWritten;
      }
      readPosition += bytesRead;
    }
    await destinationHandle.sync();
    if (readPosition !== expectedSize || hash.digest("hex") !== expectedSha256)
      throw new Error(
        "Project Source content does not match the database snapshot",
      );
  } catch (error) {
    throw new Error(
      `Could not back up Project Source ${sourcePath}: ${error}`,
      {
        cause: error,
      },
    );
  } finally {
    await source?.close().catch(() => {});
    await destinationHandle?.close().catch(() => {});
  }
  const copiedStat = await stat(destinationPath);
  if (copiedStat.size !== expectedSize)
    throw new Error(
      `Project Source changed while the backup was being created: ${sourcePath}`,
    );
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

async function uploadIfConfigured(path) {
  const executable = process.env.BACKUP_UPLOAD_EXECUTABLE;
  if (!executable) return;
  const args = JSON.parse(process.env.BACKUP_UPLOAD_ARGS_JSON ?? "[]");
  if (!Array.isArray(args) || !args.every((value) => typeof value === "string"))
    throw new Error("BACKUP_UPLOAD_ARGS_JSON must be a string array");
  await run(executable, [...args, path]);
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

function absolutePath(value, name) {
  if (!value.startsWith("/") || resolve(value) !== value)
    throw new Error(`${name} must be an absolute normalized path`);
  return value;
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
