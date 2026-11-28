export const archivePattern =
  /^latex-renderer-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.\d{3}Z\.tar\.age$/;

const dayMs = 86_400_000;

export function planBackupRetention({
  archives,
  policy,
  now,
  latestVerifiedArchive,
}) {
  if (policy !== null) {
    for (const limit of ["maxAgeDays", "maxGenerations", "maxTotalBytes"]) {
      const value = policy?.[limit];
      if (!Number.isSafeInteger(value) || value < 1)
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
