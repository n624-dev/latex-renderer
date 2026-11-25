import {
  defaultRenderEngine,
  renderEngineSchema,
  renderOutputsSchema,
  type RenderEngine,
  type RenderOutput,
} from "@latex-renderer/contracts";
import {
  AppError,
  DEFAULT_RESOURCE_LIMITS,
  newId,
  nowIso,
  sha256Hex,
} from "@latex-renderer/shared";
import {
  validateEntrypointPath,
  validateSourceFilePath,
} from "@latex-renderer/zip-validation";
import type { RendererDatabase } from "./index.js";
import { ProjectOperations, type ProjectActor } from "./project-operations.js";
import type { DraftFileRow, DraftRow } from "./repositories/drafts.js";
import { assertSourceWritable } from "./source-lifecycle.js";

export interface DraftUpdate {
  version: number;
  entrypoint?: string | undefined;
  engine?: RenderEngine | undefined;
  outputs?: readonly RenderOutput[] | undefined;
  files: readonly (
    | { path: string; remove: true }
    | { path: string; sourceId: string; sourcePath: string }
  )[];
}

export class ProjectDraftOperations {
  constructor(
    private readonly db: RendererDatabase,
    private readonly maxFiles = DEFAULT_RESOURCE_LIMITS.maxFileCount,
    private readonly maxEntries = DEFAULT_RESOURCE_LIMITS.maxZipEntries,
  ) {}

  get(actor: ProjectActor, projectId: string) {
    this.assertOwned(actor, projectId);
    const row = this.db.drafts.snapshotOwned(projectId, actor.userId);
    return row === undefined
      ? null
      : this.snapshot(row, JSON.parse(row.files_json) as DraftFileRow[]);
  }

  open(
    actor: ProjectActor,
    projectId: string,
    initialRevisionId?: string,
    requireNew = false,
  ) {
    return this.db.transaction(() => {
      this.assertOwned(actor, projectId);
      const existing = this.db.drafts.getOwned(projectId, actor.userId);
      if (existing !== undefined) {
        if (requireNew)
          throw new AppError(
            "DRAFT_ALREADY_EXISTS",
            "A shared draft already exists",
            409,
            { currentVersion: existing.version },
          );
        return this.snapshot(existing);
      }
      assertSourceWritable(this.db);
      const revisionId =
        initialRevisionId ?? this.db.projects.latestRevision(projectId)?.id;
      if (revisionId === undefined)
        throw new AppError(
          "DRAFT_SOURCE_REQUIRED",
          "A source is required to open a draft",
          409,
        );
      const { revision, source } = new ProjectOperations(this.db).revision(
        actor,
        projectId,
        revisionId,
      );
      const timestamp = nowIso();
      const draft: DraftRow = {
        project_id: projectId,
        base_revision_id: revision.id,
        version: 1,
        entrypoint: revision.entrypoint,
        engine: revision.engine,
        outputs_json: revision.outputs_json,
        created_at: timestamp,
        updated_at: timestamp,
      };
      const sourcePaths = this.db.sources.paths(source);
      this.checkPaths(sourcePaths, draft.entrypoint);
      this.db.drafts.insert(draft);
      for (const path of sourcePaths)
        this.db.drafts.putFile(projectId, {
          path,
          source_id: source.id,
          source_path: path,
        });
      return this.snapshot(draft);
    });
  }

  update(actor: ProjectActor, projectId: string, input: DraftUpdate) {
    return this.db.transaction(() =>
      this.updateInTransaction(actor, projectId, input),
    );
  }

  startEmptyInTransaction(
    actor: ProjectActor,
    projectId: string,
    sourceId: string,
  ) {
    if (!this.db.raw.isTransaction)
      throw new Error("Draft initialization requires a write transaction");
    this.assertOwned(actor, projectId);
    const existing = this.db.drafts.getOwned(projectId, actor.userId);
    if (existing) return this.snapshot(existing);
    if (this.db.projects.latestRevision(projectId))
      throw new AppError(
        "DRAFT_VERSION_CONFLICT",
        "A saved revision was created while opening the draft",
        409,
      );
    assertSourceWritable(this.db);
    const timestamp = nowIso();
    const source = this.db.sources.getOwnedReady(
      sourceId,
      actor.userId,
      timestamp,
    );
    if (!source)
      throw new AppError(
        "SOURCE_NOT_READY",
        "Draft Source is unavailable",
        409,
      );
    this.checkPaths(this.db.sources.paths(source), "main.tex");
    const row: DraftRow = {
      project_id: projectId,
      version: 1,
      entrypoint: "main.tex",
      engine: defaultRenderEngine,
      outputs_json: '["pdf"]',
      created_at: timestamp,
      updated_at: timestamp,
    };
    this.db.drafts.insert(row);
    this.db.drafts.putFile(projectId, {
      path: "main.tex",
      source_id: sourceId,
      source_path: "main.tex",
    });
    return this.snapshot(row);
  }

  replaceFromRevision(
    actor: ProjectActor,
    projectId: string,
    revisionId: string,
    version: number,
  ) {
    return this.db.transaction(() => {
      this.assertOwned(actor, projectId);
      assertSourceWritable(this.db);
      const current = this.db.drafts.getOwned(projectId, actor.userId);
      if (!current || current.version !== version)
        throw new AppError(
          "DRAFT_VERSION_CONFLICT",
          "The draft has changed since it was loaded",
          409,
        );
      const { revision, source } = new ProjectOperations(this.db).revision(
        actor,
        projectId,
        revisionId,
      );
      const paths = this.db.sources.paths(source);
      this.checkPaths(paths, revision.entrypoint);
      const next = {
        ...current,
        base_revision_id: revision.id,
        version: current.version + 1,
        entrypoint: revision.entrypoint,
        engine: revision.engine,
        outputs_json: revision.outputs_json,
        updated_at: nowIso(),
      };
      if (!Number.isSafeInteger(next.version))
        throw new Error("Draft version overflow");
      if (!this.db.drafts.update(next, version))
        throw new AppError(
          "DRAFT_VERSION_CONFLICT",
          "The draft has changed since it was loaded",
          409,
        );
      const selected = new Set(paths);
      for (const file of this.db.drafts.files(projectId))
        if (!selected.has(file.path))
          this.db.drafts.removeFile(projectId, file.path);
      for (const path of paths)
        this.db.drafts.putFile(projectId, {
          path,
          source_id: source.id,
          source_path: path,
        });
      this.db.drafts.supersedeQueued(projectId, next.updated_at);
      this.db.projects.touch(projectId, next.updated_at);
      return this.snapshot(next);
    });
  }

  queuePreview(
    actor: ProjectActor,
    projectId: string,
    version: number,
    options: {
      serviceAccountId: string;
      apiKeyId: string;
      rendererVersion: string;
      runtime: string | null;
      retentionHours?: number | undefined;
      reservedOutputBytes: number;
      admit: () => void;
    },
  ): { jobId: string; version: number; reused: boolean } {
    return this.db.transaction(() => {
      const row = this.db.drafts.getOwned(projectId, actor.userId);
      if (row === undefined)
        throw new AppError("DRAFT_NOT_FOUND", "Draft does not exist", 404);
      if (row.version !== version)
        throw new AppError(
          "DRAFT_VERSION_CONFLICT",
          "The draft has changed since it was loaded",
          409,
        );
      const existing = this.db.drafts.pendingRender(
        projectId,
        version,
        options.runtime,
      );
      if (existing !== undefined)
        return { jobId: existing, version, reused: true };
      const files = this.db.drafts.files(projectId);
      this.checkPaths(
        files.map(({ path }) => path),
        row.entrypoint,
      );
      const manifestSha256 = sha256Hex(JSON.stringify(files));
      const runtimeDigest = /(?:^|@)(sha256:[a-f0-9]{64})$/.exec(
        options.runtime ?? "",
      )?.[1];
      if (runtimeDigest !== undefined) {
        const completed = this.db.drafts
          .completedRender({
            projectId,
            userId: actor.userId,
            entrypoint: row.entrypoint,
            engine: row.engine,
            manifestSha256,
            runtimeDigest,
          })
          .find(
            (id) =>
              this.db.artifacts.getDownloadable(id, "result.pdf", {
                retentionHours: options.retentionHours ?? 24,
              }) !== undefined,
          );
        if (completed !== undefined) {
          this.db.drafts.supersedeQueued(projectId, nowIso());
          return { jobId: completed, version, reused: true };
        }
      }
      const timestamp = nowIso(),
        jobId = newId("job");
      // Rollback restores the older queued request if admission or insertion fails.
      this.db.drafts.supersedeQueued(projectId, timestamp);
      options.admit();
      this.db.jobs.insertDraftRender({
        id: jobId,
        userId: actor.userId,
        serviceAccountId: options.serviceAccountId,
        apiKeyId: options.apiKeyId,
        rendererVersion: options.rendererVersion,
        manifestSha256,
        entrypoint: row.entrypoint,
        engine: row.engine,
        timestamp,
        reservedOutputBytes: options.reservedOutputBytes,
      });
      this.db.drafts.attachRender(jobId, projectId, version, options.runtime);
      return { jobId, version, reused: false };
    });
  }

  previewActivity(
    actor: ProjectActor,
    projectId: string,
    runtime: string | null,
    retentionHours: number,
  ) {
    this.assertOwned(actor, projectId);
    return this.db.drafts.previewActivity(
      projectId,
      actor.userId,
      runtime,
      retentionHours,
    );
  }

  updateInTransaction(
    actor: ProjectActor,
    projectId: string,
    input: DraftUpdate,
  ) {
    if (!this.db.raw.isTransaction)
      throw new Error("Draft update requires a write transaction");
    assertSourceWritable(this.db);
    const row = this.db.drafts.getOwned(projectId, actor.userId);
    if (row === undefined)
      throw new AppError("DRAFT_NOT_FOUND", "Draft does not exist", 404);
    if (row.version !== input.version)
      throw new AppError(
        "DRAFT_VERSION_CONFLICT",
        "The draft has changed since it was loaded",
        409,
      );
    if (input.files.length > this.maxFiles * 2)
      throw new AppError(
        "ZIP_TOO_MANY_FILES",
        "Draft change count exceeds the file limit",
        422,
      );
    const nextVersion = row.version + 1;
    if (!Number.isSafeInteger(nextVersion))
      throw new Error("Draft version overflow");
    const files = new Map(
      this.db.drafts.files(projectId).map((file) => [file.path, file]),
    );
    const changed = new Map<string, DraftFileRow | null>();
    const timestamp = nowIso();
    const sourcePaths = new Map<string, ReadonlySet<string>>();
    for (const change of input.files) {
      const path = validateSourceFilePath(change.path);
      if (changed.has(path))
        throw new AppError(
          "DRAFT_DUPLICATE_CHANGE",
          "A path was changed more than once",
          422,
        );
      if ("remove" in change) {
        files.delete(path);
        changed.set(path, null);
      } else {
        let paths = sourcePaths.get(change.sourceId);
        if (paths === undefined) {
          const source = this.db.sources.getOwnedReady(
            change.sourceId,
            actor.userId,
            timestamp,
          );
          if (source === undefined)
            throw new AppError(
              "SOURCE_NOT_READY",
              "Draft Source does not exist or is not ready",
              409,
            );
          paths = new Set(this.db.sources.paths(source));
          sourcePaths.set(change.sourceId, paths);
        }
        const sourcePath = validateSourceFilePath(change.sourcePath);
        if (!paths.has(sourcePath))
          throw new AppError(
            "SOURCE_FILE_NOT_FOUND",
            "Draft Source does not contain the requested file",
            422,
          );
        const file = {
          path,
          source_id: change.sourceId,
          source_path: sourcePath,
        };
        files.set(path, file);
        changed.set(path, file);
      }
    }
    const entrypoint = validateEntrypointPath(
      input.entrypoint ?? row.entrypoint,
    );
    this.checkPaths([...files.keys()], entrypoint);
    const outputs = renderOutputsSchema.parse(
      input.outputs ?? JSON.parse(row.outputs_json),
    );
    const updated: DraftRow = {
      ...row,
      version: nextVersion,
      entrypoint,
      engine: renderEngineSchema.parse(input.engine ?? row.engine),
      outputs_json: outputs.includes("svg") ? '["pdf","svg"]' : '["pdf"]',
      updated_at: timestamp,
    };
    if (!this.db.drafts.update(updated, input.version))
      throw new AppError(
        "DRAFT_VERSION_CONFLICT",
        "The draft has changed since it was loaded",
        409,
      );
    for (const [path, file] of changed)
      if (file === null) this.db.drafts.removeFile(projectId, path);
      else this.db.drafts.putFile(projectId, file);
    this.db.projects.touch(projectId, timestamp);
    return this.snapshot(updated);
  }

  private assertOwned(actor: ProjectActor, projectId: string): void {
    if (this.db.projects.getOwned(projectId, actor.userId) === undefined)
      throw new AppError("PROJECT_NOT_FOUND", "Project does not exist", 404);
  }

  private checkPaths(paths: readonly string[], entrypoint: string): void {
    if (!paths.includes(entrypoint))
      throw new AppError(
        "ENTRYPOINT_MISSING",
        "Draft does not contain the requested entrypoint",
        422,
      );
    if (paths.length > this.maxFiles)
      throw new AppError(
        "ZIP_TOO_MANY_FILES",
        "Draft file count exceeds the file limit",
        422,
      );
    const pathsAndFolders = new Map<
      string,
      { original: string; folder: boolean }
    >();
    for (const path of paths) {
      const parts = validateSourceFilePath(path).split("/");
      for (let i = 0; i < parts.length; i++) {
        const original = parts.slice(0, i + 1).join("/"),
          key = original.normalize("NFC").toLowerCase(),
          folder = i < parts.length - 1,
          previous = pathsAndFolders.get(key);
        if (
          previous !== undefined &&
          (previous.original !== original || !previous.folder || !folder)
        )
          throw new AppError("DRAFT_PATH_CONFLICT", "Draft paths collide", 422);
        pathsAndFolders.set(key, { original, folder });
        if (pathsAndFolders.size > this.maxEntries)
          throw new AppError(
            "ZIP_TOO_MANY_ENTRIES",
            "Draft entry count exceeds the ZIP limit",
            422,
          );
      }
    }
  }

  private snapshot(
    row: DraftRow,
    files = this.db.drafts.files(row.project_id),
  ) {
    return {
      projectId: row.project_id,
      baseRevisionId: row.base_revision_id ?? null,
      version: row.version,
      entrypoint: row.entrypoint,
      engine: row.engine,
      outputs: renderOutputsSchema.parse(JSON.parse(row.outputs_json)),
      files: files.map((file) => ({
        path: file.path,
        sourceId: file.source_id,
        sourcePath: file.source_path,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
