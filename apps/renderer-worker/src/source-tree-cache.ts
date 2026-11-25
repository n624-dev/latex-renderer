import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  statfs,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import type {
  RendererDatabase,
  SourceTreeRow,
  WorkerJobRow,
} from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import {
  captureValidatedSourceTree,
  extractValidatedSourceFiles,
  validateAndExtract,
  verifyValidatedSourceTree,
  type VerifiedSourceTree,
  type ZipLimits,
} from "@latex-renderer/zip-validation";
import { rendererRuntimeDigest, type WorkerConfig } from "./config.js";
import { dockerStopVerified, rendererContainerName } from "./docker.js";
import { collectSourceTrees } from "../../../deploy/scripts/source-tree-gc.mjs";
export { collectSourceTrees } from "../../../deploy/scripts/source-tree-gc.mjs";

function treePath(storageRoot: string, id: string) {
  if (!/^tree_[a-f0-9]{32}$/.test(id))
    throw new Error("Invalid Source tree identity");
  return join(resolve(storageRoot), "source-trees", id);
}
function limitsFor(config: WorkerConfig): ZipLimits {
  return {
    maxExtractedBytes: config.maxExtractedBytes,
    maxFileBytes: config.maxUploadBytes,
    maxEntries: config.maxZipEntries,
    maxFiles: config.maxFileCount,
    maxDepth: 10,
    maxNameLength: 200,
  };
}

/** Readers hold persistent pins until their exact daemon container is proven
 * stopped. GC never guesses from PID, directory mtime or lease expiry. */
export async function recoverSourceTreeReaders(db: RendererDatabase) {
  for (const reader of db.sourceTrees.readers()) {
    const job = db.worker.runtimeState(reader.job_id);
    if (job?.lease_owner != null) continue;
    if (!/^job_[a-f0-9]{32}$/.test(reader.job_id))
      throw new Error("Invalid Source reader Job");
    try {
      await dockerStopVerified(
        rendererContainerName(reader.job_id, reader.generation),
      );
    } catch {
      continue;
    }
    db.sourceTrees.release(reader);
  }
}

/** Uses a fully validated per-attempt input on a miss. Promotion is a same-FS
 * rename, never another full copy; only published, owner-bound trees can hit. */
export async function prepareSourceInput(
  db: RendererDatabase,
  config: WorkerConfig,
  job: WorkerJobRow,
  archive: string,
  destination: string,
): Promise<{ input: string; release: () => void; hit: boolean }> {
  const canonicalRoot = await realpath(config.storageRoot);
  const limits = limitsFor(config);
  const owner = db.jobs.get(job.id)?.user_id;
  const draft = db.drafts.renderInput(job.id);
  if (draft) {
    const expected = rendererRuntimeDigest(draft.runtime ?? "");
    if (expected !== null && expected !== rendererRuntimeDigest(config.image))
      throw new AppError(
        "DRAFT_RUNTIME_CHANGED",
        "Runtime changed. Request a new preview.",
        409,
      );
    if (
      owner === undefined ||
      draft.files.length > limits.maxFiles ||
      !draft.files.some((file) => file.path === job.entrypoint)
    )
      throw new AppError(
        "INVALID_DRAFT_INPUT",
        "The preview input is incomplete",
        422,
      );
    const manifest = draft.files.map(({ path, source_id, source_path }) => ({
      path,
      source_id,
      source_path,
    }));
    if (
      createHash("sha256").update(JSON.stringify(manifest)).digest("hex") !==
      job.source_sha256
    )
      throw new AppError(
        "INVALID_DRAFT_INPUT",
        "The preview file manifest changed",
        422,
      );
    const archives = new Map<string, typeof draft.files>();
    for (const file of draft.files) {
      if (file.owner_user_id !== owner || file.status !== "ready")
        throw new AppError(
          "SOURCE_NOT_READY",
          "A preview Source is unavailable",
          409,
        );
      const files = archives.get(file.source_id) ?? [];
      files.push(file);
      archives.set(file.source_id, files);
    }
    await mkdir(destination, { mode: 0o770 });
    let remaining = limits.maxExtractedBytes;
    for (const files of archives.values()) {
      const file = files[0];
      if (!file) throw new Error("Draft archive group is empty");
      if (
        file.storage_key !== `sources/${file.source_id}/source.zip` &&
        !/^jobs\/job_[a-f0-9]{32}\/input\/source\.zip$/.test(file.storage_key)
      )
        throw new AppError(
          "SOURCE_NOT_READY",
          "A preview Source path is invalid",
          409,
        );
      if (!/^source_[a-f0-9]{32}$/.test(file.source_id))
        throw new AppError(
          "SOURCE_NOT_READY",
          "A preview Source ID is invalid",
          409,
        );
      const path = join(canonicalRoot, file.storage_key);
      if ((await realpath(path)) !== path)
        throw new AppError(
          "SOURCE_NOT_READY",
          "A preview Source path is unsafe",
          409,
        );
      await verifyArchive(path, file.size, file.sha256, config.maxUploadBytes);
      remaining -= await extractValidatedSourceFiles(
        path,
        destination,
        files.map(({ path, source_path }) => ({
          path,
          sourcePath: source_path,
        })),
        { ...limits, maxExtractedBytes: remaining },
      );
    }
    return { input: destination, release: () => {}, hit: false };
  }
  const source =
    job.source_id === null
      ? undefined
      : db.sources.getReady(job.source_id, nowIso());
  if (
    source &&
    (source.owner_user_id !== owner ||
      source.sha256 !== job.source_sha256 ||
      source.size !== job.source_size)
  )
    throw new AppError(
      "SOURCE_NOT_READY",
      "Source identity does not match the owned Job",
      409,
    );
  const eligible =
    source !== undefined &&
    owner !== undefined &&
    /^source_[a-f0-9]{32}$/.test(source.id) &&
    (config.sourceTreeMaxBytes ?? 0) > 0 &&
    (config.sourceTreeUserMaxBytes ?? 0) > 0;
  const identity = createHash("sha256")
    .update(
      JSON.stringify({
        format: 1,
        validator: 1,
        limits,
        source: job.source_id,
        owner,
        sha256: job.source_sha256,
        bytes: job.source_size,
      }),
    )
    .digest("hex");
  const releaseFor = (row: SourceTreeRow) => () =>
    db.sourceTrees.release({
      tree_id: row.id,
      job_id: job.id,
      generation: job.lease_generation,
    });
  if (eligible) {
    const row = db.sourceTrees.acquire(
      identity,
      owner,
      job.id,
      job.lease_generation,
      nowIso(),
    );
    if (row) {
      try {
        if (
          row.reserved_bytes >
          Math.min(
            config.sourceTreeMaxBytes ?? 0,
            config.sourceTreeUserMaxBytes ?? 0,
          )
        )
          throw new Error("Source tree exceeds current cache budget");
        const root = treePath(canonicalRoot, row.id),
          input = join(root, "input");
        if (
          (await realpath(root)) !== root ||
          (await realpath(input)) !== input
        )
          throw new Error("Unsafe Source tree path");
        await verifyValidatedSourceTree(
          input,
          JSON.parse(row.manifest_json) as VerifiedSourceTree,
          limits,
          job.entrypoint,
        );
        return { input, release: releaseFor(row), hit: true };
      } catch {
        db.sourceTrees.invalidate(row.id);
        releaseFor(row)();
      }
    }
  }
  await verifyArchive(
    archive,
    job.source_size,
    job.source_sha256,
    config.maxUploadBytes,
  );
  const extracted = await validateAndExtract(
      archive,
      destination,
      limits,
      job.entrypoint,
    ),
    fallback = { input: destination, release: () => {}, hit: false };
  if (!eligible) return fallback;
  let manifest: VerifiedSourceTree;
  try {
    manifest = await captureValidatedSourceTree(destination, extracted, limits);
  } catch {
    return fallback;
  }
  const manifestJson = JSON.stringify(manifest),
    fs = await statfs(destination),
    block = fs.bsize;
  if (!Number.isSafeInteger(block) || block <= 0) return fallback;
  if (
    fs.bavail * fs.bsize <
    (config.minFreeStorageBytes ?? 5 * 1024 ** 3) + 128 * 1024
  )
    return fallback;
  let reservedBytes =
    64 * 1024 + Math.ceil(Buffer.byteLength(manifestJson) / block) * block;
  for (const path of [
    destination,
    ...manifest.directories
      .filter((d) => d.path !== "")
      .map((d) => join(destination, d.path)),
    ...manifest.files.map((f) => join(destination, f.path)),
  ]) {
    const info = await lstat(path);
    reservedBytes += Math.max(
      Number.isFinite(info.blocks) ? info.blocks * 512 : 0,
      Math.max(1, Math.ceil(info.size / block)) * block,
    );
  }
  // Cached input is not free space: include filesystem blocks, directories,
  // manifest and bounded DB overhead in both cache and existing user quotas.
  const now = nowIso(),
    row: SourceTreeRow = {
      id: newId("tree"),
      identity,
      source_id: source.id,
      owner_user_id: owner,
      status: "building",
      reserved_bytes: reservedBytes,
      manifest_json: manifestJson,
      created_at: now,
      expires_at: new Date(
        Date.now() + (config.sourceTreeTtlMs ?? 21600000),
      ).toISOString(),
      last_used_at: now,
    };
  const reserve = () =>
    db.sourceTrees.reserve(
      row,
      job.id,
      job.lease_generation,
      config.sourceTreeMaxBytes ?? 0,
      config.sourceTreeUserMaxBytes ?? 0,
      config.maxUserStorageBytes ?? 1024 ** 3,
    );
  if (!reserve()) {
    try {
      await collectSourceTrees(db.raw, config.storageRoot, true, 1);
    } catch {
      return fallback;
    }
    if (!reserve()) return fallback;
  }
  const root = treePath(canonicalRoot, row.id),
    input = join(root, "input");
  let moved = false;
  try {
    const parent = join(canonicalRoot, "source-trees");
    await mkdir(parent, { recursive: true, mode: 0o770 });
    if ((await realpath(parent)) !== parent)
      throw new Error("Unsafe Source cache root");
    await mkdir(root, { mode: 0o770 });
    await chmod(root, 0o770);
    await rename(destination, input);
    moved = true;
    db.sourceTrees.publish(row.id);
    return { input, release: releaseFor(row), hit: false };
  } catch (error) {
    try {
      if (moved) await rename(input, destination);
    } finally {
      db.sourceTrees.invalidate(row.id);
      releaseFor(row)();
    }
    config.diagnostic?.({
      event: "renderer_worker.source_tree_promotion_failed",
      code: (error as NodeJS.ErrnoException).code ?? "CACHE_UNAVAILABLE",
    });
    return fallback;
  }
}

async function verifyArchive(
  path: string,
  size: number,
  sha256: string,
  maximum: number,
) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      before.size !== size ||
      size > maximum
    )
      throw new AppError(
        "SOURCE_CHECKSUM_INVALID",
        "Source identity is invalid",
      );
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const value of file.createReadStream({
      autoClose: false,
      highWaterMark: 65536,
    })) {
      const chunk = value as Buffer;
      bytes += chunk.length;
      if (bytes > size)
        throw new AppError("SOURCE_CHECKSUM_INVALID", "Source size changed");
      hash.update(chunk);
    }
    const after = await file.stat();
    if (
      bytes !== size ||
      hash.digest("hex") !== sha256 ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw new AppError("SOURCE_CHECKSUM_INVALID", "Source checksum changed");
  } finally {
    await file.close();
  }
}
