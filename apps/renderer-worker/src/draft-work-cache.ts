import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rm,
  statfs,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  ARTIFACT_DOWNLOAD_LEASE_MS,
  protectArtifactDownloadLeases,
  type DraftWorkCacheIdentity,
  type RendererDatabase,
  type WorkerJobRow,
} from "@latex-renderer/database";
import { newId, nowIso } from "@latex-renderer/shared";
import { rendererRuntimeDigest, type WorkerConfig } from "./config.js";

const directory = ".draft-work";
const maxEntryBytes = 1024 * 1024;
const sourceScanLimit = 256 * 1024;
const seedExtensions = ["aux", "toc", "out", "bbl", "fdb_latexmk"];

export async function identifyDraftWorkCache(
  database: RendererDatabase,
  config: WorkerConfig,
  job: WorkerJobRow,
  input: string,
): Promise<DraftWorkCacheIdentity | undefined> {
  const runtime = rendererRuntimeDigest(config.image);
  if (!config.draftWorkCacheBytes || !runtime) return;
  const draft = database.drafts.renderInput(job.id);
  const owner = database.jobs.get(job.id)?.user_id;
  if (
    !draft?.files.length ||
    !owner ||
    draft.files.some((file) => file.owner_user_id !== owner)
  )
    return;
  try {
    const handle = await open(
      join(input, job.entrypoint),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > sourceScanLimit) return;
      const source = await handle.readFile("utf8");
      const begin = /^[ \t]*\\begin\{document\}/m.exec(source);
      if (!begin) return;
      const hash = createHash("sha256");
      hash.update(
        JSON.stringify([
          1,
          owner,
          draft.projectId,
          runtime,
          job.engine,
          job.entrypoint,
          job.outputs_json,
          draft.files.map((file) =>
            file.path === job.entrypoint
              ? [file.path]
              : [file.path, file.source_path, file.sha256],
          ),
        ]),
      );
      hash.update(source.slice(0, begin.index));
      // Changes to explicit inclusion, bibliography or build directives in the
      // document body also invalidate the seed, even with unchanged attachments.
      for (const line of source.slice(begin.index).split("\n")) {
        if (
          /\\(?:include(?:only|graphics)?|input|bibliography(?:style)?|addbibresource|nocite|usepackage|newcommand|renewcommand|def)(?![A-Za-z])/.test(
            line,
          )
        )
          hash.update("\0").update(line);
      }
      return {
        userId: owner,
        projectId: draft.projectId,
        version: draft.version,
        key: hash.digest("hex"),
      };
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
}

function allowedNames(entrypoint: string) {
  const stem = basename(entrypoint).slice(0, -4);
  return new Set(seedExtensions.map((extension) => `${stem}.${extension}`));
}

async function filesAt(
  path: string,
  allowed: ReadonlySet<string>,
  privateDirectory: boolean,
) {
  if ((await realpath(path)) !== path) return;
  const files = [];
  let bytes = 0;
  for (const name of [...allowed].sort()) {
    const file = join(path, name);
    const info = await lstat(file).catch((error: unknown) => {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
      return undefined;
    });
    if (!info) continue;
    if (!info.isFile() || info.nlink !== 1 || info.size === 0) return;
    bytes += info.size;
    if (bytes > maxEntryBytes) return;
    files.push({ name, file });
  }
  if (privateDirectory && (await readdir(path)).length !== files.length) return;
  return files.length > 0 ? { files, bytes } : undefined;
}

async function copyFiles(
  files: readonly { name: string; file: string }[],
  destination: string,
) {
  await mkdir(destination, { mode: 0o770 });
  for (const { file, name } of files)
    await copyFile(
      file,
      join(destination, name),
      constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE,
    );
}

export async function loadDraftWorkCache(
  database: RendererDatabase,
  config: WorkerConfig,
  identity: DraftWorkCacheIdentity,
  entrypoint: string,
  destination: string,
): Promise<boolean> {
  const id = newId("lease");
  let release = () => {};
  const lease = { lost: false };
  try {
    const candidate = database.transaction(() => {
      const row = database.drafts.availableWorkCache(
        identity,
        config.artifactRetentionHours ?? 24,
      );
      if (
        !row ||
        !/^job_[a-f0-9]{32}$/.test(row.jobId) ||
        !Number.isSafeInteger(row.generation) ||
        row.generation < 1
      )
        return;
      const now = nowIso();
      database.artifacts.createLease({
        id,
        jobId: row.jobId,
        artifactId: row.artifactId,
        createdAt: now,
        expiresAt: new Date(
          Date.parse(now) + ARTIFACT_DOWNLOAD_LEASE_MS,
        ).toISOString(),
      });
      return row;
    });
    if (!candidate) return false;
    release = protectArtifactDownloadLeases(database.artifacts, [id], () => {
      lease.lost = true;
    });
    const root = await realpath(config.storageRoot);
    const path = join(
      root,
      "jobs",
      candidate.jobId,
      "outputs",
      String(candidate.generation),
      directory,
    );
    const seed = await filesAt(path, allowedNames(entrypoint), true);
    if (!seed || seed.bytes !== candidate.bytes) return false;
    await copyFiles(seed.files, destination);
    if (lease.lost) throw new Error("Draft working-state cache lease was lost");
    config.diagnostic?.({
      event: "renderer_worker.draft_work_cache_loaded",
      bytes: seed.bytes,
    });
    return true;
  } catch {
    await rm(destination, { recursive: true, force: true }).catch(() => {});
    return false;
  } finally {
    release();
  }
}

export async function storeDraftWorkCache(
  database: RendererDatabase,
  config: WorkerConfig,
  identity: DraftWorkCacheIdentity,
  job: WorkerJobRow,
  staging: string,
  publication: string,
): Promise<boolean> {
  const destination = join(publication, directory);
  let reserved = false;
  try {
    const cache = await filesAt(
      await realpath(staging),
      allowedNames(job.entrypoint),
      false,
    );
    if (!cache) return false;
    const space = await statfs(dirname(destination), { bigint: true });
    if (
      space.bavail * space.bsize <
      BigInt((config.minFreeStorageBytes ?? 0) + cache.bytes)
    )
      return false;
    const bytes = config.draftWorkCacheBytes ?? 0;
    reserved = database.transaction(() => {
      if (
        config.maxUserStorageBytes !== undefined &&
        database.jobs.storageUsageForUser(identity.userId) >
          config.maxUserStorageBytes - cache.bytes
      )
        return false;
      return database.drafts.reserveWorkCache(
        {
          ...identity,
          jobId: job.id,
          generation: job.lease_generation,
          bytes: cache.bytes,
        },
        {
          bytes,
          userBytes: Math.floor(bytes / 2),
          projectBytes: Math.floor(bytes / 8),
          entries: 128,
          userEntries: 32,
          projectEntries: 4,
        },
      );
    });
    if (!reserved) return false;
    await copyFiles(cache.files, destination);
    config.diagnostic?.({
      event: "renderer_worker.draft_work_cache_stored",
      bytes: cache.bytes,
    });
    return true;
  } catch {
    if (reserved) {
      // Discard the quota reservation only after removing its physical files.
      try {
        await rm(destination, { recursive: true, force: true });
        database.drafts.releaseWorkCache(job.id, job.lease_generation);
      } catch {
        // An incomplete optional seed is a cache miss. Preserve its accounting
        // until the existing Job recovery or cleanup removes the files.
        return true;
      }
    }
    return false;
  }
}
