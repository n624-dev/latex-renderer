import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  open,
  readdir,
  rm,
  unlink,
} from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SqliteConnectionStore } from "./sqlite-connections.js";
import {
  connectionApplicationId,
  connectionSchemaVersion,
} from "./sqlite-schema.js";

export const gatewayBackupRetentionMs = 7 * 86_400_000;
const backupName =
  /^public-mcp-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z)-[a-f0-9]{32}\.sqlite\.age$/;

/** Save only the gateway connection database, using a dedicated age recipient. */
export async function backUpGatewayDatabase(options: {
  databasePath: string;
  backupDirectory: string;
  recipientFile: string;
  now: number;
  signal: AbortSignal;
}): Promise<string> {
  const { databasePath, backupDirectory, recipientFile, now, signal } = options;
  await requirePrivateDirectory(backupDirectory);
  if (
    !isAbsolute(databasePath) ||
    !isAbsolute(recipientFile) ||
    !(await lstat(databasePath)).isFile()
  )
    throw new Error(
      "Use an existing gateway database and an absolute age recipient path",
    );
  const stamp = new Date(now).toISOString().replaceAll(":", "-");
  const destination = join(
    backupDirectory,
    `public-mcp-${stamp}-${randomUUID().replaceAll("-", "")}.sqlite.age`,
  );
  signal.throwIfAborted();
  const staging = await mkdtemp(join(backupDirectory, ".public-mcp-backup-"));
  try {
    const snapshot = join(staging, "connections.sqlite");
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      assertGatewayDatabase(database);
      database.prepare("VACUUM INTO ?").run(snapshot);
    } finally {
      database.close();
    }
    signal.throwIfAborted();
    const encrypted = join(staging, "connections.sqlite.age");
    await runAge(["-R", recipientFile, "-o", encrypted, snapshot], signal);
    await chmod(encrypted, 0o600);
    await syncPath(encrypted);
    await link(encrypted, destination);
    await syncPath(backupDirectory);
    await pruneGatewayBackups(backupDirectory, now);
    return destination;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** Prepare a replacement file offline and publish only after credentials are invalidated. */
export async function prepareRestoredGatewayDatabase(options: {
  backupPath: string;
  destination: string;
  identityFile: string;
  now: number;
  signal: AbortSignal;
}): Promise<number> {
  const { backupPath, destination, identityFile, now, signal } = options;
  if (
    ![backupPath, destination, identityFile].every(isAbsolute) ||
    !Number.isSafeInteger(now)
  )
    throw new Error(
      "Gateway recovery requires absolute paths and an exact recovery time",
    );
  const directory = dirname(destination);
  await requirePrivateDirectory(directory);
  for (const path of [
    destination,
    `${destination}-wal`,
    `${destination}-shm`,
    `${destination}-journal`,
  ]) {
    try {
      await lstat(path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        continue;
      throw error;
    }
    throw new Error("Gateway recovery requires an unused destination");
  }
  signal.throwIfAborted();
  const staging = await mkdtemp(join(directory, ".public-mcp-restore-"));
  try {
    const snapshot = join(staging, "connections.sqlite");
    await runAge(
      ["-d", "-i", identityFile, "-o", snapshot, backupPath],
      signal,
    );
    await chmod(snapshot, 0o600);
    const recovered = new DatabaseSync(snapshot, { readOnly: true });
    try {
      assertGatewayDatabase(recovered);
      const status = recovered.prepare("PRAGMA integrity_check").all();
      if (
        status.length !== 1 ||
        status[0]?.integrity_check !== "ok" ||
        recovered.prepare("PRAGMA foreign_key_check").get() !== undefined
      )
        throw new Error("The gateway backup failed database integrity checks");
    } finally {
      recovered.close();
    }
    const store = new SqliteConnectionStore(snapshot);
    let count: number;
    try {
      count = store.invalidateRestoredAuthorizations(now);
    } finally {
      store.close();
    }
    signal.throwIfAborted();
    await syncPath(snapshot);
    await link(snapshot, destination);
    await syncPath(directory);
    return count;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function pruneGatewayBackups(
  directory: string,
  now: number,
): Promise<number> {
  await requirePrivateDirectory(directory);
  if (!Number.isSafeInteger(now))
    throw new Error("An exact retention time is required");
  let removed = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const stamp = backupName.exec(entry.name)?.[1];
    if (!stamp) continue;
    const at = Date.parse(stamp.replace(/T(\d{2})-(\d{2})-/, "T$1:$2:"));
    if (!Number.isFinite(at) || now - at < gatewayBackupRetentionMs) continue;
    await unlink(join(directory, entry.name));
    removed++;
  }
  if (removed) await syncPath(directory);
  return removed;
}

export function assertGatewayDatabase(db: DatabaseSync): void {
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (
    db.prepare("PRAGMA application_id").get()?.application_id !==
      connectionApplicationId ||
    (version !== 1 && version !== 2 && version !== connectionSchemaVersion)
  )
    throw new Error("The database does not belong to the public MCP gateway");
}

async function requirePrivateDirectory(directory: string): Promise<void> {
  if (!isAbsolute(directory))
    throw new Error("Use an absolute gateway backup path");
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.mode & 0o077 ||
    (process.getuid !== undefined && info.uid !== process.getuid())
  )
    throw new Error(
      "Gateway backups require a private directory owned by the gateway user",
    );
}

async function syncPath(path: string): Promise<void> {
  const file = await open(path, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

function runAge(args: readonly string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("age", args, { stdio: "ignore", signal });
    child.once("error", () =>
      reject(new Error("Could not execute age for the gateway backup")),
    );
    child.once("close", (exitCode) =>
      exitCode === 0
        ? resolve()
        : reject(new Error("Gateway backup encryption or decryption failed")),
    );
  });
}
