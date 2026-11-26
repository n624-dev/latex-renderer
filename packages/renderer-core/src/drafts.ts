import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  ProjectDocumentState,
  ProjectDraftOperations,
  ProjectOperations,
  assertSourceWritable,
  type ProjectActor,
  type RendererDatabase,
} from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { RenderOutput } from "@latex-renderer/contracts";
import {
  extractValidatedSourceFiles,
  readValidatedSourceFile,
  validateSourceFilePath,
} from "@latex-renderer/zip-validation";
import {
  syncFile,
  syncPublishedAncestors,
} from "../../../deploy/scripts/durable-storage.mjs";
import yazl from "yazl";
import {
  boundedArchiveStream,
  readDirectoryFiles,
  sha256File,
  writeZipFiles,
  zipFiles,
} from "./source-archive.js";
import { RendererSourceStore, SOURCE_UPLOAD_MS } from "./source-store.js";
import { directSourceLimits } from "./environment.js";

export class RendererDrafts {
  constructor(
    private readonly database: RendererDatabase,
    private readonly sources: RendererSourceStore,
  ) {}

  async openProjectDraft(
    actor: ProjectActor,
    projectId: string,
    revisionId?: string,
  ) {
    const drafts = new ProjectDraftOperations(
      this.database,
      this.sources.resourceLimits.maxFileCount,
      this.sources.resourceLimits.maxZipEntries,
    );
    try {
      return drafts.open(actor, projectId, revisionId);
    } catch (error) {
      if (
        !(error instanceof AppError) ||
        error.code !== "DRAFT_SOURCE_REQUIRED" ||
        revisionId !== undefined
      )
        throw error;
    }
    const path = "main.tex";
    const archive = await zipFiles(
      [{ path, bytes: Buffer.alloc(0) }],
      this.sources.zipLimits(),
    );
    let draft:
      ReturnType<ProjectDraftOperations["startEmptyInTransaction"]> | undefined;
    await this.sources.storeReadySource(
      actor.userId,
      archive,
      [path],
      (sourceId) => {
        draft = drafts.startEmptyInTransaction(actor, projectId, sourceId);
      },
    );
    if (!draft) throw new Error("Draft initialization did not commit");
    return draft;
  }

  async readDraftText(
    actor: ProjectActor,
    projectId: string,
    version: number,
    path: string,
  ) {
    const { draft, path: target } = this.requireDraftVersion(
      actor,
      projectId,
      version,
      path,
    );
    const file = draft.files.find((entry) => entry.path === target);
    if (file === undefined)
      throw new AppError(
        "SOURCE_FILE_NOT_FOUND",
        "Draft file does not exist",
        404,
      );
    const source = this.sources.resolveOwnedSource(actor.userId, file.sourceId);
    const bytes = await readValidatedSourceFile(
      this.sources.sourcePath(source),
      file.sourcePath,
      this.sources.zipLimits(),
    );
    try {
      return {
        path: target,
        version,
        text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
      };
    } catch {
      throw new AppError(
        "DRAFT_TEXT_ENCODING",
        "Draft file is not UTF-8. Convert it explicitly before editing.",
        422,
      );
    }
  }

  async saveDraftText(
    actor: ProjectActor,
    projectId: string,
    version: number,
    path: string,
    text: string,
  ) {
    assertSourceWritable(this.database);
    const { drafts, path: target } = this.requireDraftVersion(
      actor,
      projectId,
      version,
      path,
    );
    if (
      Buffer.byteLength(text) >
      directSourceLimits(this.sources.resourceLimits).fileBytes
    )
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Draft text exceeds the direct file limit",
        422,
      );
    const archive = await zipFiles(
      [{ path: target, bytes: Buffer.from(text, "utf8") }],
      this.sources.zipLimits(),
    );
    let updated: ReturnType<ProjectDraftOperations["update"]> | undefined;
    await this.sources.storeReadySource(
      actor.userId,
      archive,
      [target],
      (sourceId) => {
        updated = drafts.updateInTransaction(actor, projectId, {
          version,
          files: [{ path: target, sourceId, sourcePath: target }],
        });
      },
    );
    if (updated === undefined) throw new Error("Draft update did not commit");
    return updated;
  }

  async saveDraftFileContent(
    actor: ProjectActor,
    projectId: string,
    file: { version: number; path: string; size: number; utf8: boolean },
    body: ReadableStream<Uint8Array> | null,
    signal: AbortSignal,
  ) {
    assertSourceWritable(this.database);
    const { drafts, path: target } = this.requireDraftVersion(
      actor,
      projectId,
      file.version,
      file.path,
    );
    const maximum = this.sources.resourceLimits.maxUploadBytes;
    if (
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      file.size > maximum
    )
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Draft file exceeds the upload limit",
        413,
      );
    const id = newId("source");
    const storageKey = `sources/${id}/source.zip`;
    const archive = join(this.sources.storageRoot, storageKey);
    const timestamp = nowIso();
    const reservedBytes = Math.min(
      maximum,
      file.size +
        Math.ceil(file.size / 100) +
        Buffer.byteLength(target) * 2 +
        1024,
    );
    this.database.transaction(() => {
      assertSourceWritable(this.database);
      this.sources.assertStorageQuota(actor.userId, reservedBytes);
      this.database.sources.insertReserved({
        id,
        ownerUserId: actor.userId,
        storageKey,
        timestamp,
        size: reservedBytes,
        sha256: "0".repeat(64),
        expiresAt: new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString(),
        dedupeEligible: false,
      });
    });
    let retained = false;
    try {
      await mkdir(dirname(archive), { recursive: true, mode: 0o770 });
      // The DOM and Node declarations use different BYOB reader signatures.
      const input =
        body === null
          ? Readable.from([])
          : Readable.fromWeb(
              body as unknown as Parameters<typeof Readable.fromWeb>[0],
            );
      const decoder = file.utf8
        ? new TextDecoder("utf-8", { fatal: true })
        : undefined;
      let received = 0;
      const checked = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.byteLength;
          if (received > file.size) {
            callback(
              new AppError(
                "SOURCE_FILE_SIZE",
                "Draft file is longer than declared",
                413,
              ),
            );
            return;
          }
          try {
            decoder?.decode(chunk, { stream: true });
            callback(null, chunk);
          } catch {
            callback(
              new AppError(
                "DRAFT_TEXT_ENCODING",
                "Draft text must be UTF-8",
                422,
              ),
            );
          }
        },
        flush(callback) {
          if (received !== file.size) {
            callback(
              new AppError(
                "SOURCE_FILE_SIZE",
                "Draft file is shorter than declared",
                422,
              ),
            );
            return;
          }
          try {
            decoder?.decode();
            callback();
          } catch {
            callback(
              new AppError(
                "DRAFT_TEXT_ENCODING",
                "Draft text must be UTF-8",
                422,
              ),
            );
          }
        },
      });
      const zip = new yazl.ZipFile();
      const compressed = zip.outputStream as Readable;
      const abort = AbortSignal.any([
        signal,
        AbortSignal.timeout(SOURCE_UPLOAD_MS),
      ]);
      const inputResult = pipeline(input, checked, { signal: abort });
      zip.on("error", (error: Error) => compressed.destroy(error));
      zip.addReadStreamLazy(
        target,
        { mtime: new Date(0), mode: 0o600, size: file.size },
        (callback) => callback(null, checked),
      );
      const outputResult = pipeline(
        compressed,
        boundedArchiveStream(reservedBytes),
        createWriteStream(archive, { flags: "wx", mode: 0o660 }),
        { signal: abort },
      );
      try {
        zip.end();
        await Promise.all([inputResult, outputResult]);
      } catch (error) {
        checked.destroy();
        compressed.destroy();
        await Promise.allSettled([inputResult, outputResult]);
        throw error;
      }
      const metadata = await stat(archive);
      const sha256 = await sha256File(archive);
      await syncFile(archive);
      await syncPublishedAncestors(archive, this.sources.storageRoot);
      const saved = this.database.transaction(() => {
        assertSourceWritable(this.database);
        const now = nowIso();
        const existing = this.database.sources.findReady(
          actor.userId,
          sha256,
          metadata.size,
          now,
        );
        if (existing === undefined)
          this.database.sources.transitionBeforeExpiry(
            id,
            ["reserved"],
            "ready",
            now,
            {
              sha256,
              size: String(metadata.size),
              dedupe_eligible: "1",
              expires_at: this.sources.sourceRetentionExpiresAt(),
              uploaded_at: now,
              paths_json: JSON.stringify([target]),
            },
          );
        const next = drafts.updateInTransaction(actor, projectId, {
          version: file.version,
          files: [
            { path: target, sourceId: existing?.id ?? id, sourcePath: target },
          ],
        });
        return { next, keep: existing === undefined };
      });
      retained = saved.keep;
      return saved.next;
    } finally {
      if (!retained) {
        await rm(dirname(archive), { recursive: true, force: true });
        this.database.transaction(() => {
          this.database.sources.discardReservation(id);
        });
      }
    }
  }

  async saveDraftRevision(
    actor: ProjectActor,
    projectId: string,
    version: number,
    displayName: string,
    outputs?: readonly RenderOutput[],
    changeDescription?: string,
  ) {
    assertSourceWritable(this.database);
    const drafts = new ProjectDraftOperations(
      this.database,
      this.sources.resourceLimits.maxFileCount,
      this.sources.resourceLimits.maxZipEntries,
    );
    const draft = drafts.get(actor, projectId);
    if (draft === null)
      throw new AppError("DRAFT_NOT_FOUND", "Draft does not exist", 404);
    if (draft.version !== version)
      throw new AppError(
        "DRAFT_VERSION_CONFLICT",
        "The draft has changed since it was loaded",
        409,
      );
    const groups = new Map<string, typeof draft.files>();
    for (const file of draft.files) {
      const files = groups.get(file.sourceId) ?? [];
      files.push(file);
      groups.set(file.sourceId, files);
    }
    const save = (sourceId: string) => {
      const current = this.database.drafts.getOwned(projectId, actor.userId);
      if (current?.version !== version)
        throw new AppError(
          "DRAFT_VERSION_CONFLICT",
          "The draft has changed since it was loaded",
          409,
        );
      const revision = new ProjectOperations(
        this.database,
      ).attachRevisionInTransaction(actor, {
        projectId,
        sourceId,
        displayName,
        entrypoint: draft.entrypoint,
        engine: draft.engine,
        originalFilename: draft.entrypoint.split("/").at(-1) ?? "source.zip",
        outputs: outputs ?? draft.outputs,
      });
      new ProjectDocumentState(this.database).recordRevisionChange(actor, {
        projectId,
        revisionId: revision.id,
        parentRevisionId: current.base_revision_id ?? null,
        draftVersion: version,
        description: changeDescription ?? "",
      });
      this.database.drafts.setBaseRevision(projectId, version, revision.id);
      return revision;
    };
    const [group] = groups;
    if (groups.size === 1 && group !== undefined) {
      const [sourceId, files] = group;
      const source = this.sources.resolveOwnedSource(actor.userId, sourceId);
      if (
        files.length === this.database.sources.paths(source).length &&
        files.every(({ path, sourcePath }) => path === sourcePath)
      )
        return this.database.transaction(() => save(source.id));
    }
    const directory = await mkdtemp(
      join(this.sources.storageRoot, ".remote-archive-"),
    );
    try {
      const input = join(directory, "input");
      await mkdir(input, { mode: 0o700 });
      const limits = this.sources.zipLimits();
      let remaining = limits.maxExtractedBytes;
      for (const [sourceId, files] of groups) {
        const source = this.sources.resolveOwnedSource(actor.userId, sourceId);
        const archive = this.sources.sourcePath(source);
        const info = await stat(archive);
        if (
          !info.isFile() ||
          info.size !== source.size ||
          (await sha256File(archive)) !== source.sha256
        )
          throw new AppError(
            "SOURCE_CHECKSUM_INVALID",
            "Source changed after validation",
            409,
          );
        remaining -= await extractValidatedSourceFiles(archive, input, files, {
          ...limits,
          maxExtractedBytes: remaining,
        });
      }
      const files = await readDirectoryFiles(input, "", {
        files: 0,
        bytes: 0,
        maxFiles: limits.maxFiles,
        maxBytes: limits.maxExtractedBytes,
        maxFileBytes: limits.maxFileBytes,
      });
      const archive = join(directory, "source.zip");
      await writeZipFiles(files, archive, limits);
      let revision: ReturnType<typeof save> | undefined;
      await this.sources.storeReadySourceArchive(
        actor.userId,
        archive,
        draft.files.map(({ path }) => path),
        (sourceId) => {
          revision = save(sourceId);
        },
      );
      if (revision === undefined)
        throw new Error("Draft revision did not commit");
      return revision;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  private requireDraftVersion(
    actor: ProjectActor,
    projectId: string,
    version: number,
    candidate: string,
  ) {
    const drafts = new ProjectDraftOperations(
      this.database,
      this.sources.resourceLimits.maxFileCount,
      this.sources.resourceLimits.maxZipEntries,
    );
    const draft = drafts.get(actor, projectId);
    if (draft === null)
      throw new AppError("DRAFT_NOT_FOUND", "Draft does not exist", 404);
    if (draft.version !== version)
      throw new AppError(
        "DRAFT_VERSION_CONFLICT",
        "The draft has changed since it was loaded",
        409,
      );
    return { drafts, draft, path: validateSourceFilePath(candidate) };
  }
}
