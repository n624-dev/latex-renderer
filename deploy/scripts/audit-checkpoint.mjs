import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

const digestPattern = /^[a-f0-9]{64}$/;
const maximumSequence = 9223372036854775807n;

export async function readAuditCheckpoint(path) {
  let handle, encoded;
  try {
    handle = await open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const details = await handle.stat();
    if (!details.isFile() || details.size > 4096)
      throw new Error("Invalid audit export checkpoint file");
    encoded = await handle.readFile("utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { format: 0 };
    throw error;
  } finally {
    await handle?.close();
  }
  let value;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error("Invalid audit export checkpoint JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid audit export checkpoint schema");
  if (value.format === 3) {
    validateCurrentCheckpoint(value);
    if (
      Object.keys(value).sort().join(",") !==
        "databaseId,format,sequence,sha256,token" ||
      value.sha256 !== checkpointHash(value)
    )
      throw new Error("Invalid audit export checkpoint checksum");
    const { format, databaseId, sequence, token } = value;
    return { format, databaseId, sequence, token };
  }
  // Legacy positions are validated, but never used for export selection or GC:
  // created_at/random IDs cannot distinguish late rows from exported rows.
  if (
    Object.keys(value).some(
      (key) => !["format", "sha256", "createdAt", "id"].includes(key),
    ) ||
    typeof value.createdAt !== "string" ||
    typeof value.id !== "string" ||
    (value.createdAt === "") !== (value.id === "") ||
    (value.createdAt !== "" && !Number.isFinite(Date.parse(value.createdAt))) ||
    value.createdAt.length > 64 ||
    value.id.length > 200
  )
    throw new Error("Invalid audit export checkpoint schema");
  if (value.format !== undefined || value.sha256 !== undefined) {
    if (
      value.format !== 2 ||
      value.sha256 !==
        createHash("sha256")
          .update(`${value.createdAt}\n${value.id}\n`)
          .digest("hex")
    )
      throw new Error("Invalid audit export checkpoint checksum");
  }
  return {
    format: value.format ?? 1,
    createdAt: value.createdAt,
    id: value.id,
  };
}

export async function writeAuditCheckpoint(path, checkpoint) {
  validateCurrentCheckpoint(checkpoint);
  const payload = `${JSON.stringify({ ...checkpoint, sha256: checkpointHash(checkpoint) })}\n`;
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.chmod(0o640);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    await syncAuditDirectory(parent);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function syncAuditDirectory(path) {
  const directory = await open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export function readAuditDatabaseState(database) {
  if (
    !database.prepare("SELECT 1 FROM schema_migrations WHERE version=18").get()
  )
    throw new Error("Audit export requires database migration 18");
  const states = database
    .prepare("SELECT singleton,database_id FROM audit_export_state")
    .all();
  if (
    states.length !== 1 ||
    states[0].singleton !== 1 ||
    !digestPattern.test(states[0].database_id)
  )
    throw new Error("Invalid audit export database identity");
  const triggers = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type='trigger'
    AND name IN ('audit_export_insert','audit_export_delete','audit_export_immutable')`,
    )
    .all();
  if (
    triggers.length !== 3 ||
    database
      .prepare(
        `SELECT 1 FROM audit_logs a WHERE NOT EXISTS
      (SELECT 1 FROM audit_export_sequence e WHERE e.audit_id=a.id) LIMIT 1`,
      )
      .get() ||
    database
      .prepare(
        `SELECT 1 FROM audit_export_sequence e WHERE e.audit_id IS NOT NULL AND NOT EXISTS
      (SELECT 1 FROM audit_logs a WHERE a.id=e.audit_id) LIMIT 1`,
      )
      .get()
  )
    throw new Error("Invalid audit export sequence coverage");
  const highWater = String(
    database
      .prepare(
        `SELECT CAST(COALESCE(
    (SELECT seq FROM sqlite_sequence WHERE name='audit_export_sequence'),0) AS TEXT) AS value`,
      )
      .get().value,
  );
  if (
    !validSequence(highWater) ||
    database
      .prepare("SELECT 1 FROM audit_export_sequence WHERE sequence>? LIMIT 1")
      .get(BigInt(highWater))
  )
    throw new Error("Invalid audit export sequence high-water mark");
  return { databaseId: states[0].database_id, highWater };
}

export function validateAuditCheckpoint(
  database,
  checkpoint,
  state = readAuditDatabaseState(database),
) {
  validateCurrentCheckpoint(checkpoint);
  if (
    checkpoint.databaseId !== state.databaseId ||
    BigInt(checkpoint.sequence) > BigInt(state.highWater)
  )
    throw new Error(
      "Audit export checkpoint does not match this database; explicit replay is required after recovery",
    );
  if (checkpoint.sequence !== "0") {
    const anchor = database
      .prepare("SELECT token FROM audit_export_sequence WHERE sequence=?")
      .get(BigInt(checkpoint.sequence));
    if (anchor?.token !== checkpoint.token)
      throw new Error(
        "Audit export checkpoint anchor does not match this database; explicit replay is required after recovery",
      );
  }
  return checkpoint;
}

function validateCurrentCheckpoint(checkpoint) {
  if (
    checkpoint?.format !== 3 ||
    !digestPattern.test(checkpoint.databaseId ?? "") ||
    !validSequence(checkpoint.sequence) ||
    (checkpoint.sequence === "0"
      ? checkpoint.token !== ""
      : !digestPattern.test(checkpoint.token ?? ""))
  )
    throw new Error("Invalid audit export checkpoint schema");
}

function validSequence(value) {
  return (
    typeof value === "string" &&
    /^(0|[1-9][0-9]{0,18})$/.test(value) &&
    BigInt(value) <= maximumSequence
  );
}

function checkpointHash({ databaseId, sequence, token }) {
  return createHash("sha256")
    .update(`audit-export-v3\n${databaseId}\n${sequence}\n${token}\n`)
    .digest("hex");
}
