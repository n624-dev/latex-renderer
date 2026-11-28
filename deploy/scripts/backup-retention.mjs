import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as filesystem from "node:fs/promises";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export const archivePattern =
  /^latex-renderer-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z\.tar\.age$/;
export const backupRetentionSettingKey = "backup_retention_policy";
export const verificationReceiptPath =
  "/var/lib/latex-renderer-backup-verification/latest.json";
export const retentionStatePath = (receiptPath) =>
  join(dirname(receiptPath), "retention.json");

const dayMs = 86_400_000;
const retentionLimits = ["maxAgeDays", "maxGenerations", "maxTotalBytes"];

function validLimit(limit, value) {
  return (
    Number.isSafeInteger(value) && value >= (limit === "maxTotalBytes" ? 0 : 1)
  );
}

export function isBackupRetentionProposal(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === retentionLimits.length &&
    retentionLimits.every(
      (limit) => Object.hasOwn(value, limit) && validLimit(limit, value[limit]),
    )
  );
}

export function backupRetentionCandidates({
  archives,
  freeBytes,
  minFreeStorageBytes,
}) {
  if (archives.length === 0) return null;
  const totalBytes = archives.reduce(
    (sum, archive) => sum + BigInt(archive.bytes),
    0n,
  );
  const latest = archives.reduce((newest, archive) =>
    archive.name > newest.name ? archive : newest,
  );
  const available =
    BigInt(freeBytes) + totalBytes - BigInt(minFreeStorageBytes);
  const budget = available > 0n ? available / 4n : 0n;
  const size = BigInt(latest.bytes);
  const generations =
    budget === 0n
      ? 1
      : size === 0n
        ? 30
        : Math.max(1, Math.min(Number(budget / size), 30));
  return {
    maxAgeDays: generations,
    maxGenerations: generations,
    maxTotalBytes: Number(budget),
  };
}

export function readLiveBackupRetentionPolicy(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return readBackupRetentionPolicy(db);
  } finally {
    db.close();
  }
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
  if (!retentionLimits.every((limit) => validLimit(limit, value?.[limit])))
    return { policy: null, warning: "POLICY_INVALID" };
  const {
    maxAgeDays,
    maxGenerations,
    maxTotalBytes,
    confirmedAt,
    confirmedBy,
  } = value;
  if (
    typeof confirmedAt !== "string" ||
    !Number.isFinite(Date.parse(confirmedAt)) ||
    typeof confirmedBy !== "string" ||
    confirmedBy.trim() === ""
  )
    return { policy: null, warning: "POLICY_INVALID" };
  return {
    policy: {
      maxAgeDays,
      maxGenerations,
      maxTotalBytes,
      confirmedAt,
      confirmedBy,
    },
    warning: null,
  };
}

async function readBackupState(path, { expectedUid, maxBytes, fs }) {
  try {
    const info = await fs.lstat(path);
    if (
      !info.isFile() ||
      info.uid !== expectedUid ||
      info.mode & 0o033 ||
      info.size > maxBytes
    )
      return null;
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return null;
}

export async function readVerificationReceipt(
  path,
  { expectedUid = 0, fs = filesystem } = {},
) {
  const record = await readBackupState(path, {
    expectedUid,
    maxBytes: 4096,
    fs,
  });
  if (
    archivePattern.test(record?.archive) &&
    typeof record.verifiedAt === "string"
  )
    return { archive: record.archive, verifiedAt: record.verifiedAt };
  return null;
}

export function readLastRetentionRun(
  path,
  { fs = filesystem, expectedUid = 0 } = {},
) {
  return readBackupState(path, { expectedUid, maxBytes: 1024 * 1024, fs });
}

export async function writeBackupState(path, record, fs = filesystem) {
  let gid;
  try {
    const group = execFileSync(
      "/usr/bin/getent",
      ["group", "latex-renderer-backup"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 5000,
      },
    );
    gid = Number(group.split(":")[2]);
    if (!Number.isInteger(gid) || gid <= 0 || gid >= 0xffffffff)
      throw new Error("Invalid backup group ID");
  } catch (error) {
    if (error.status !== 2) throw error;
  }
  const pending = `${path}.${randomUUID()}.part`;
  const file = await fs.open(pending, "wx", 0o600);
  try {
    try {
      await file.writeFile(JSON.stringify(record) + "\n");
      if (gid !== undefined) await file.chown(0, gid);
      await file.chmod(gid === undefined ? 0o600 : 0o640);
      await file.sync();
    } finally {
      await file.close();
    }
    await fs.rename(pending, path);
  } finally {
    await fs.rm(pending, { force: true });
  }
}

export async function withBackupStateLock(receiptPath, run, timeoutSeconds) {
  const directory = await filesystem.open(dirname(receiptPath), "r");
  try {
    // flock locks the inherited open file description until this handle closes.
    const args =
      timeoutSeconds === undefined ? [] : ["--timeout", String(timeoutSeconds)];
    const lock = spawnSync("/usr/bin/flock", [...args, "3"], {
      stdio: ["ignore", "ignore", "inherit", directory.fd],
    });
    if (lock.status !== 0)
      throw new Error("Could not lock backup verification and retention state");
    return await run();
  } finally {
    await directory.close();
  }
}

export function planBackupRetention({
  archives,
  policy,
  now,
  latestVerifiedArchive,
}) {
  if (policy !== null) {
    for (const limit of retentionLimits) {
      if (!validLimit(limit, policy?.[limit]))
        throw new Error(`${limit} is outside the supported integer range`);
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

export async function listBackupArchives(directory, fs = filesystem) {
  const archives = [];
  for (const name of await fs.readdir(directory)) {
    if (!archivePattern.test(name)) continue;
    try {
      const info = await fs.lstat(join(directory, name));
      if (info.isFile()) archives.push({ name, bytes: info.size });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return archives;
}

export async function applyBackupRetention({
  directory,
  policy,
  now,
  latestVerifiedArchive,
  fs = filesystem,
  deleted = [],
  warnings = [],
}) {
  const plan = planBackupRetention({
    archives: await listBackupArchives(directory, fs),
    policy,
    now,
    latestVerifiedArchive,
  });
  warnings.push(...plan.warnings);
  const alreadyAbsent = [];
  try {
    for (const name of plan.delete) {
      const path = join(directory, name);
      try {
        if (!(await fs.lstat(path)).isFile()) continue;
        await fs.unlink(path);
        deleted.push(name);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        alreadyAbsent.push(name);
      }
    }
  } finally {
    if (deleted.length > 0) {
      const handle = await fs.open(directory, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
  }
  return { ...plan, deleted, alreadyAbsent, warnings };
}

export async function runPostBackupRetention({
  databasePath,
  directory,
  receiptPath = verificationReceiptPath,
  statePath = retentionStatePath(receiptPath),
  now = new Date(),
  log = console.log,
  fs = filesystem,
  writeState = writeBackupState,
  lockTimeoutSeconds,
}) {
  if (statePath === null) return await run();
  return await withBackupStateLock(receiptPath, run, lockTimeoutSeconds);

  async function run() {
    const deleted = [];
    const warnings = [];
    const at = now.toISOString();
    let result;
    try {
      const { policy, warning } = readLiveBackupRetentionPolicy(databasePath);
      if (warning) warnings.push(warning);
      let receipt;
      try {
        receipt = await readVerificationReceipt(receiptPath, { fs });
      } catch (error) {
        warnings.push("RECEIPT_UNREADABLE");
        throw error;
      }

      // The root runner keeps working in the same directory if its path is renamed.
      const handle =
        statePath === null
          ? null
          : await fs.open(
              directory,
              constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY,
            );
      try {
        const archiveDirectory =
          handle === null ? directory : `/proc/self/fd/${handle.fd}`;
        if (
          handle !== null &&
          (await fs.realpath(archiveDirectory)) !== directory
        )
          throw new Error(
            "Backup directory must be an absolute path without symbolic links",
          );
        result = await applyBackupRetention({
          directory: archiveDirectory,
          policy,
          now,
          latestVerifiedArchive: receipt?.archive,
          fs,
          deleted,
          warnings,
        });
      } finally {
        await handle?.close();
      }
    } catch (error) {
      result = undefined;
      warnings.push("PRUNE_FAILED");
      log(
        JSON.stringify({
          event: "backup.retention_failed",
          message: error.message,
          deleted,
          warnings,
        }),
      );
    }
    const summary = {
      at,
      deleted,
      warnings,
      status: result ? "succeeded" : "failed",
    };
    try {
      if (statePath !== null) await writeState(statePath, summary, fs);
    } catch (error) {
      warnings.push("STATE_WRITE_FAILED");
      log(
        JSON.stringify({
          event: "backup.retention_failed",
          message: error.message,
          deleted,
          warnings,
        }),
      );
      return { ...summary, status: "failed" };
    }
    if (result) {
      log(
        JSON.stringify({
          event: "backup.retention",
          configured: result.configured,
          deleted,
          alreadyAbsent: result.alreadyAbsent,
          keptCount: result.keep.length,
          keptBytes: result.keptBytes,
          deletedBytes: result.deletedBytes,
          warnings,
        }),
      );
    }
    return { ...result, ...summary };
  }
}
