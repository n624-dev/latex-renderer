import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  assertSourceWritable,
  defaultSourceOrphanRetentionMinutes,
  assertUserStorageQuota,
  type RendererDatabase,
  type SourceRow,
} from "@latex-renderer/database";
import {
  AppError,
  newId,
  nowIso,
  sha256Hex,
  type ResourceLimits,
} from "@latex-renderer/shared";
import {
  syncFile,
  syncPublishedAncestors,
} from "../../../deploy/scripts/durable-storage.mjs";
import { sha256File, type SourceZipLimits } from "./source-archive.js";

export const SOURCE_UPLOAD_MS = 10 * 60_000;

export class RendererSourceStore {
  constructor(
    private readonly database: RendererDatabase,
    readonly storageRoot: string,
    readonly resourceLimits: Readonly<ResourceLimits>,
    private readonly maxUserStorageBytes: number,
  ) {}

  async storeReadySource(
    userId: string,
    archive: Buffer,
    paths: readonly string[],
    onReady?: (sourceId: string) => void,
  ): Promise<SourceRow> {
    assertSourceWritable(this.database);
    const sha256 = sha256Hex(archive),
      existing = this.database.sources.findReady(
        userId,
        sha256,
        archive.byteLength,
        nowIso(),
      );
    if (existing !== undefined) {
      if (onReady !== undefined)
        this.database.transaction(() => onReady(existing.id));
      return existing;
    }
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = this.sourceRetentionExpiresAt(),
      stagingExpiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.assertStorageQuota(userId, archive.byteLength);
      assertSourceWritable(this.database);
      this.database.sources.insertReserved({
        id: sourceId,
        ownerUserId: userId,
        size: archive.byteLength,
        sha256,
        storageKey,
        timestamp,
        expiresAt: stagingExpiresAt,
      });
    });
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o770 });
      await writeFile(path, archive, {
        flag: "wx",
        mode: 0o660,
        flush: true,
      });
      await syncPublishedAncestors(path, this.storageRoot);
      this.database.transaction(() => {
        assertSourceWritable(this.database);
        this.database.sources.transitionBeforeExpiry(
          sourceId,
          ["reserved"],
          "ready",
          nowIso(),
          {
            uploaded_at: nowIso(),
            expires_at: expiresAt,
            paths_json: JSON.stringify(paths),
          },
        );
        onReady?.(sourceId);
      });
    } catch (error) {
      await rm(dirname(path), { recursive: true, force: true });
      this.database.transaction(() => {
        this.database.sources.discardReservation(sourceId);
      });
      throw error;
    }
    const source = this.database.sources.get(sourceId);
    if (source === undefined)
      throw new AppError("SOURCE_CREATE_FAILED", "Source creation failed");
    return source;
  }

  /** Promote a revision archive that was streamed to local storage. */
  async storeReadySourceArchive(
    userId: string,
    archive: string,
    paths: readonly string[],
    onReady?: (sourceId: string) => void,
  ): Promise<SourceRow> {
    assertSourceWritable(this.database);
    const metadata = await stat(archive);
    if (
      !metadata.isFile() ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 1 ||
      metadata.size > this.resourceLimits.maxUploadBytes
    )
      throw new AppError(
        "SOURCE_ARCHIVE_SIZE",
        "Source archive size is invalid",
        422,
      );
    const sha256 = await sha256File(archive),
      verified = await stat(archive);
    if (!verified.isFile() || verified.size !== metadata.size)
      throw new AppError(
        "SOURCE_FILE_CHANGED",
        "Source changed while its revision was being archived",
        409,
      );
    const existing = this.database.sources.findReady(
      userId,
      sha256,
      metadata.size,
      nowIso(),
    );
    if (existing !== undefined) {
      if (onReady !== undefined)
        this.database.transaction(() => onReady(existing.id));
      return existing;
    }
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = this.sourceRetentionExpiresAt(),
      stagingExpiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.assertStorageQuota(userId, metadata.size);
      assertSourceWritable(this.database);
      this.database.sources.insertReserved({
        id: sourceId,
        ownerUserId: userId,
        size: metadata.size,
        sha256,
        storageKey,
        timestamp,
        expiresAt: stagingExpiresAt,
      });
    });
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o770 });
      await rename(archive, path);
      await syncFile(path);
      await syncPublishedAncestors(path, this.storageRoot);
      this.database.transaction(() => {
        assertSourceWritable(this.database);
        this.database.sources.transitionBeforeExpiry(
          sourceId,
          ["reserved"],
          "ready",
          nowIso(),
          {
            uploaded_at: nowIso(),
            expires_at: expiresAt,
            paths_json: JSON.stringify(paths),
          },
        );
        onReady?.(sourceId);
      });
    } catch (error) {
      await rm(dirname(path), { recursive: true, force: true });
      this.database.transaction(() => {
        this.database.sources.discardReservation(sourceId);
      });
      throw error;
    }
    const source = this.database.sources.get(sourceId);
    if (source === undefined)
      throw new AppError("SOURCE_CREATE_FAILED", "Source creation failed");
    return source;
  }

  assertStorageQuota(userId: string, bytes: number): void {
    assertUserStorageQuota(
      this.database,
      userId,
      this.maxUserStorageBytes,
      bytes,
    );
  }

  zipLimits(): SourceZipLimits {
    return {
      maxArchiveBytes: this.resourceLimits.maxUploadBytes,
      maxExtractedBytes: this.resourceLimits.maxExtractedBytes,
      maxFileBytes: this.resourceLimits.maxUploadBytes,
      maxEntries: this.resourceLimits.maxZipEntries,
      maxFiles: this.resourceLimits.maxFileCount,
      maxDepth: 10,
      maxNameLength: 200,
    };
  }

  assertOwnedSource(userId: string, sourceId: string): SourceRow {
    const source = this.database.sources.getOwned(sourceId, userId);
    if (source === undefined)
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    return source;
  }

  resolveOwnedSource(userId: string, sourceId: string): SourceRow {
    const source = this.assertOwnedSource(userId, sourceId);
    if (
      this.database.sources.getOwnedReady(source.id, userId, nowIso()) ===
      undefined
    )
      throw new AppError("SOURCE_NOT_READY", "Source is not ready", 409);
    return source;
  }

  sourcePath(source: SourceRow): string {
    if (
      source.storage_key.startsWith("/") ||
      source.storage_key.split("/").includes("..")
    )
      throw new AppError(
        "SOURCE_STORAGE_INVALID",
        "Source storage path is invalid",
      );
    return join(this.storageRoot, source.storage_key);
  }

  sourceRetentionExpiresAt(): string {
    const minutes = this.database.settings.value(
      "source_orphan_retention_minutes",
      defaultSourceOrphanRetentionMinutes,
    );
    return new Date(Date.now() + minutes * 60_000).toISOString();
  }
}
