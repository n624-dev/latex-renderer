import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export async function readAuditCheckpoint(path) {
  let encoded;
  try {
    encoded = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { createdAt: "", id: "" };
    throw error;
  }
  let value;
  try {
    value = JSON.parse(encoded);
  } catch {
    throw new Error("Invalid audit export checkpoint JSON");
  }
  if (
    typeof value !== "object" ||
    value === null ||
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
      typeof value.sha256 !== "string" ||
      value.sha256 !== checkpointHash(value.createdAt, value.id)
    )
      throw new Error("Invalid audit export checkpoint checksum");
  }
  return { createdAt: value.createdAt, id: value.id };
}

export async function writeAuditCheckpoint(path, checkpoint) {
  const payload = `${JSON.stringify({
    format: 2,
    createdAt: checkpoint.createdAt,
    id: checkpoint.id,
    sha256: checkpointHash(checkpoint.createdAt, checkpoint.id),
  })}\n`;
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${randomUUID()}`;
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.chmod(0o640);
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
    const directory = await open(parent, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function checkpointHash(createdAt, id) {
  return createHash("sha256").update(`${createdAt}\n${id}\n`).digest("hex");
}
