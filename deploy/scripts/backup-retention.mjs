import { lstat, open, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const archivePattern =
  /^latex-renderer-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z\.tar\.age$/;
export const backupRetentionSettingKey = "backup_retention_policy";
export const verificationReceiptPath =
  "/var/lib/latex-renderer-backup-verification/latest.json";

const dayMs = 86_400_000;
const retentionLimits = ["maxAgeDays", "maxGenerations", "maxTotalBytes"];

function isPositiveSafeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

export function readBackupRetentionPolicy(db) {
  let row;
  try {
    const statement = db.prepare(
      "SELECT value_json FROM system_settings WHERE key=?",
    );
    // Read unexpected SQLite integers without a conversion error.
    statement.setReadBigInts(true);
    row = statement.get(backupRetentionSettingKey);
  } catch (error) {
    if (
      error.code === "ERR_SQLITE_ERROR" &&
      error.message === "no such table: system_settings"
    )
      return { policy: null, warning: null };
    throw error;
  }
  if (!row) return { policy: null, warning: null };

  let value;
  try {
    if (typeof row.value_json === "string") value = JSON.parse(row.value_json);
  } catch {
    return { policy: null, warning: "POLICY_INVALID" };
  }
  if (!retentionLimits.every((limit) => isPositiveSafeInteger(value?.[limit])))
    return { policy: null, warning: "POLICY_INVALID" };
  const { maxAgeDays, maxGenerations, maxTotalBytes } = value;
  return {
    policy: { maxAgeDays, maxGenerations, maxTotalBytes },
    warning: null,
  };
}

export async function readVerificationReceipt(path, { expectedUid = 0 } = {}) {
  try {
    const info = await lstat(path);
    if (
      !info.isFile() ||
      info.uid !== expectedUid ||
      info.mode & 0o033 ||
      info.size > 4096
    )
      return null;
    const record = JSON.parse(await readFile(path, "utf8"));
    if (
      archivePattern.test(record.archive) &&
      typeof record.verifiedAt === "string"
    )
      return { archive: record.archive, verifiedAt: record.verifiedAt };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

export function planBackupRetention({
  archives,
  policy,
  now,
  latestVerifiedArchive,
}) {
  if (policy !== null) {
    for (const limit of retentionLimits) {
      if (!isPositiveSafeInteger(policy?.[limit]))
        throw new Error(`${limit} must be a positive safe integer`);
    }
  }

  const byName = new Map();
  for (const archive of archives) {
    const { name } = archive;
    if (!archivePattern.test(name)) continue;
    const { bytes } = archive;
    if (!Number.isSafeInteger(bytes) || bytes < 0)
      throw new Error(`Invalid archive bytes: ${name}`);

    const stamp = name
      .slice("latex-renderer-".length, -".tar.age".length)
      .replace(/T(\d\d)-(\d\d)-/, "T$1:$2:");
    const created = new Date(stamp);
    const createdAt = created.getTime();
    if (Number.isNaN(createdAt) || created.toISOString() !== stamp)
      throw new Error(`Invalid archive timestamp: ${name}`);

    const archiveBytes = BigInt(bytes);
    const previous = byName.get(name);
    if (previous && previous.bytes !== archiveBytes)
      throw new Error(`Conflicting archive bytes: ${name}`);
    byName.set(name, { name, bytes: archiveBytes, createdAt });
  }

  const sorted = [...byName.values()].sort(
    (left, right) => right.createdAt - left.createdAt,
  );
  const protectedArchives = sorted.filter(
    ({ name }, index) => index === 0 || name === latestVerifiedArchive,
  );
  const result = {
    configured: policy !== null,
    keep: [],
    delete: [],
    protected: protectedArchives.map(({ name }) => name),
    keptBytes: 0,
    deletedBytes: 0,
    warnings: [],
  };
  const sumBytes = (total, { bytes }) => total + bytes;
  if (policy === null) {
    result.keep = sorted.map(({ name }) => name);
    result.keptBytes = Number(sorted.reduce(sumBytes, 0n));
    return result;
  }

  const nowMs = now.getTime();
  if (Number.isNaN(nowMs)) throw new Error("Invalid now timestamp");
  const maxAgeMs = policy.maxAgeDays * dayMs;
  const maxTotalBytes = BigInt(policy.maxTotalBytes);
  const isTooOld = ({ createdAt }) => Math.max(0, nowMs - createdAt) > maxAgeMs;

  let keptBytes = protectedArchives.reduce(sumBytes, 0n);
  let keptCount = protectedArchives.length;
  if (keptBytes > maxTotalBytes) result.warnings.push("PROTECTED_OVER_BYTES");
  if (keptCount > policy.maxGenerations)
    result.warnings.push("PROTECTED_OVER_GENERATIONS");
  if (protectedArchives.some(isTooOld))
    result.warnings.push("PROTECTED_OVER_AGE");

  let deletedBytes = 0n;
  let rejected = false;
  for (const archive of sorted) {
    if (protectedArchives.includes(archive)) {
      result.keep.push(archive.name);
      continue;
    }
    if (
      rejected ||
      isTooOld(archive) ||
      keptCount >= policy.maxGenerations ||
      keptBytes + archive.bytes > maxTotalBytes
    ) {
      result.delete.push(archive.name);
      deletedBytes += archive.bytes;
      rejected = true;
      continue;
    }
    result.keep.push(archive.name);
    keptBytes += archive.bytes;
    keptCount += 1;
  }

  result.keptBytes = Number(keptBytes);
  result.deletedBytes = Number(deletedBytes);
  return result;
}

export async function applyBackupRetention({
  directory,
  policy,
  now,
  latestVerifiedArchive,
}) {
  const archives = [];
  for (const name of await readdir(directory)) {
    if (!archivePattern.test(name)) continue;
    try {
      const info = await lstat(join(directory, name));
      if (info.isFile()) archives.push({ name, bytes: info.size });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  const plan = planBackupRetention({
    archives,
    policy,
    now,
    latestVerifiedArchive,
  });
  const deleted = [];
  const alreadyAbsent = [];
  try {
    for (const name of plan.delete) {
      const path = join(directory, name);
      try {
        if (!(await lstat(path)).isFile()) continue;
        await unlink(path);
        deleted.push(name);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        alreadyAbsent.push(name);
      }
    }
  } finally {
    if (deleted.length > 0) {
      const handle = await open(directory, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
  return { ...plan, deleted, alreadyAbsent };
}

export async function runPostBackupRetention({
  snapshotPath,
  directory,
  receiptPath = verificationReceiptPath,
  now = new Date(),
  log = console.log,
}) {
  try {
    const db = new DatabaseSync(snapshotPath, { readOnly: true });
    let setting;
    try {
      setting = readBackupRetentionPolicy(db);
    } finally {
      db.close();
    }
    const { policy, warning } = setting;
    const warnings = warning ? [warning] : [];
    let receipt;
    try {
      receipt = await readVerificationReceipt(receiptPath);
    } catch (error) {
      log(
        JSON.stringify({
          event: "backup.retention_skipped",
          warnings: [...warnings, "RECEIPT_UNREADABLE"],
          message: error.message,
        }),
      );
      return;
    }

    const result = await applyBackupRetention({
      directory,
      policy,
      now,
      latestVerifiedArchive: receipt?.archive,
    });
    log(
      JSON.stringify({
        event: "backup.retention",
        configured: result.configured,
        deleted: result.deleted,
        alreadyAbsent: result.alreadyAbsent,
        keptCount: result.keep.length,
        keptBytes: result.keptBytes,
        deletedBytes: result.deletedBytes,
        warnings: [...warnings, ...result.warnings],
      }),
    );
  } catch (error) {
    log(
      JSON.stringify({
        event: "backup.retention_failed",
        message: error.message,
      }),
    );
    process.exitCode = 1;
  }
}
