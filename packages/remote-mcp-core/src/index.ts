import {
  DocumentRequirementInventory,
  requirementsFingerprint,
  staticEntrypointRequirements,
  type DocumentRequirement,
} from "./document-requirements.js";
import {
  attachmentOriginForVerification,
  attachmentOrigins,
  downloadAttachment,
} from "./attachment-download.js";
import {
  readUploadedPdfInspection,
  validateUploadedPdf,
} from "./attachment-pdf.js";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  link,
  open,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { constants, createReadStream } from "node:fs";
import { dirname, join } from "node:path";
import type {
  ArtifactRow,
  JobRow,
  RemoteMcpPrincipalRow,
  RendererDatabase,
  SourceRow,
} from "@latex-renderer/database";
import {
  ProjectOperations,
  ProjectDraftOperations,
  ProjectDocumentState,
  ProjectStorage,
  SvgRetryOperations,
  artifactStoragePath,
  protectArtifactDownloadLeases,
  ARTIFACT_DOWNLOAD_LEASE_MS,
  artifactRetentionExpiresAt,
  pdfInspectionUploadDirectory,
  pdfInspectionUploadResult,
  waitForPreview,
  assertRenderEntrypoint,
  registerReadyRender,
  registerWholeRenderRetry,
  type RenderRegistrationLimits,
  type RenderStorageLimits,
  assertRenderAvailable,
  assertSourceWritable,
  createSourceReference,
} from "@latex-renderer/database";
import {
  AppError,
  DEFAULT_RESOURCE_LIMITS,
  newId,
  nowIso,
  sha256Hex,
  type ResourceLimits,
} from "@latex-renderer/shared";
import {
  validateAndExtract,
  validateEntrypointPath,
  validateSourceFilePath,
} from "@latex-renderer/zip-validation";
import {
  defaultRenderEngine,
  documentProbeSchema,
  type DocumentProbe,
  type PdfInspectionInput,
  pdfCropRequestSchema,
  type PdfCropRequest,
  type RendererRelayDownloadTarget,
  renderOutputsSchema,
  type ProjectDocumentCondition,
  type ProjectReviewCheck,
  type RenderEngine,
  type RenderReproducibility,
} from "@latex-renderer/contracts";
import {
  RendererEnvironment,
  directSourceLimits,
  inlineArtifactLimit,
  INLINE_SOURCE_MAX_BYTES,
  SOURCE_UPLOAD_CHUNK_MAX_BYTES,
  type EnvironmentSearch as RemoteEnvironmentSearch,
  type RendererCapabilities as RemoteRendererCapabilities,
} from "@latex-renderer/renderer-core";
export {
  MAX_INLINE_ARTIFACT_BYTES as REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES,
  type EnvironmentSearch as RemoteEnvironmentSearch,
  type RendererCapabilities as RemoteRendererCapabilities,
} from "@latex-renderer/renderer-core";
import {
  RendererDrafts,
  RendererSavedSources,
  inspectJobPdf,
  decodeSourceBase64,
  findOperationRequest,
  operationRequest,
  recordOperationRequest,
  type DraftChangeBatch,
  type OperationRequest,
  RendererSourceStore,
  SOURCE_UPLOAD_MS,
  readDirectoryFiles,
  sha256File,
  writeZipFiles,
  zipFiles,
} from "@latex-renderer/renderer-core";
import {
  assertLogRange,
  readLogWindow,
  renderDiagnostics,
  type RemoteRenderDiagnostics,
} from "./render-diagnostics.js";
export type {
  RemoteRenderDiagnostic,
  RemoteRenderDiagnostics,
} from "./render-diagnostics.js";
import { requireScope, type RemoteMcpIdentity } from "./oauth.js";
export {
  REMOTE_MCP_SCOPES,
  RemoteOAuthService,
  type AuthorizationRequest,
  type OAuthDiagnostic,
  type OAuthTokenResponse,
  type RemoteAccess,
  type RemoteMcpIdentity,
  type RemoteMcpScope,
} from "./oauth.js";
export type { DocumentRequirement } from "./document-requirements.js";
export {
  RemoteMcpLoginContinuations,
  oauthLoginCookie,
  oauthLoginCookieName,
} from "./login-continuations.js";

const SOURCE_UPLOAD_LEASE_MS = 60_000;
const REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT = 64 * 1024 * 1024;
const ARTIFACT_READ_CHUNK_BYTES = 64 * 1024;

export interface RemoteJobSummary {
  id: string;
  status: JobRow["status"];
  engine: RenderEngine;
  runtimeDigest: string | null;
  previousRuntimeDigest?: string;
  rendererVersion: string;
  sourceId: string | null;
  projectRevisionId: string | null;
  entrypoint: string;
  outputs: Array<"pdf" | "svg">;
  createdAt: string;
  updatedAt: string;
  queuedAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  retentionExpiresAt: string | null;
  exitCode: number | null;
  retryOf: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  previewAvailable: boolean;
  previewPages: number[];
  artifacts: Array<{
    type: string;
    filename: string;
    mimeType: string;
    relativePath: string;
    size: number;
    sha256: string;
    pageCount: number | null;
    resourceUri: string;
  }>;
  webResultUrl: string;
  stages?: import("@latex-renderer/contracts").JobStages;
}

export interface RemoteArtifactContent {
  jobId: string;
  relativePath: string;
  mimeType: string;
  size: number;
  sha256: string;
  bytes: Buffer;
}

export interface RemoteSourceFileInput {
  path: string;
  text?: string | undefined;
  base64?: string | undefined;
}

export interface RemoteSourceSummary {
  id: string;
  status: SourceRow["status"];
  size: number;
  sha256: string;
  paths: readonly string[];
  createdAt: string;
  expiresAt: string;
  revisionOf: string | null;
}

export interface RemoteSourceUpload {
  uploadId: string;
  sourceId: string;
  expectedBytes: number;
  receivedBytes: number;
  expiresAt: string;
  maxChunkBytes: number;
}

type RenderInput = {
  entrypoint?: string | undefined;
  outputs?: Array<"pdf" | "svg"> | undefined;
  engine?: RenderEngine | undefined;
  reproducibility?: RenderReproducibility | undefined;
} & (
  | { inlineSource: string }
  | { sourceRef: string }
  | { sourceId: string; project?: { projectId: string; revisionId: string } }
);

export class RemoteRenderService {
  private readonly maxInlineArtifactBytes: number;
  private readonly environment: RendererEnvironment;
  private readonly sources: RendererSourceStore;
  private readonly registrationLimits: RenderRegistrationLimits;
  readonly draftFiles: RendererDrafts;
  private inlineArtifactBytesInFlight = 0;
  private attachmentImportsInFlight = 0;
  private readonly inlineArtifactWaiters: Array<{
    bytes: number;
    resolve: (release: () => void) => void;
  }> = [];

  constructor(
    private readonly database: RendererDatabase,
    private readonly storageRoot: string,
    private readonly rendererVersion: string,
    private readonly publicOrigin: string,
    maxQueueLength = 100,
    private readonly maxUserStorageBytes = 1024 * 1024 * 1024,
    private readonly environmentRoot = "/var/lib/latex-renderer/environment",
    private readonly resourceLimits: Readonly<ResourceLimits> = DEFAULT_RESOURCE_LIMITS,
    maxOutputBytes = 200 * 1024 * 1024,
    private readonly artifactRetentionHours = 24,
    storageAdmission: Omit<RenderStorageLimits, "storageRoot"> = {},
  ) {
    this.registrationLimits = {
      ...storageAdmission,
      maxQueueLength,
      maxUserStorageBytes,
      maxOutputBytes,
      rendererVersion,
      storageRoot,
    };
    this.maxInlineArtifactBytes = inlineArtifactLimit(maxOutputBytes);
    this.sources = new RendererSourceStore(
      database,
      storageRoot,
      resourceLimits,
      maxUserStorageBytes,
    );
    this.draftFiles = new RendererDrafts(database, this.sources);
    this.environment = new RendererEnvironment(
      environmentRoot,
      rendererVersion,
      resourceLimits,
      this.maxInlineArtifactBytes,
    );
  }

  get maxInlineResourceBytes(): number {
    return this.maxInlineArtifactBytes;
  }

  get maxSourceUploadBytes(): number {
    return this.resourceLimits.maxUploadBytes;
  }

  createSourceRef(userId: string, sourceId: string) {
    return createSourceReference(this.database, userId, sourceId);
  }

  createSourceReference(
    identity: RemoteMcpIdentity,
    sourceId: string,
  ): { sourceRef: string; expiresAt: string } {
    requireScope(identity.scopes, "mcp:render");
    return this.createSourceRef(identity.userId, sourceId);
  }

  hasAttachmentImport(): boolean {
    return attachmentOrigins(process.env.REMOTE_MCP_FILE_ORIGINS).size > 0;
  }

  canVerifyAttachmentOrigin(identity: RemoteMcpIdentity): boolean {
    const verifier = process.env.REMOTE_MCP_ATTACHMENT_VERIFICATION_USER;
    return Boolean(verifier && identity.userId === verifier);
  }

  verifyAttachmentOrigin(identity: RemoteMcpIdentity, downloadUrl: string) {
    requireScope(identity.scopes, "mcp:read");
    if (!this.canVerifyAttachmentOrigin(identity))
      throw new AppError(
        "ATTACHMENT_UNSUPPORTED",
        "Attachment verification is disabled",
        404,
      );
    return { origin: attachmentOriginForVerification(downloadUrl) };
  }

  async importSourceAttachment(
    identity: RemoteMcpIdentity,
    attachment: { download_url: string; file_id: string },
    idempotencyKey: string,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const origins = attachmentOrigins(process.env.REMOTE_MCP_FILE_ORIGINS);
    if (origins.size === 0)
      throw new AppError(
        "ATTACHMENT_UNSUPPORTED",
        "Attachment import is not configured for this connection",
        501,
      );
    const request = operationRequest(
      "remote_mcp.import_source_attachment",
      idempotencyKey,
      {
        fileId: attachment.file_id,
        urlHash: sha256Hex(attachment.download_url),
      },
    );
    const replay = this.findOperationRequest(
      identity.userId,
      request,
      nowIso(),
    );
    if (replay)
      return this.summarizeSource(
        this.sources.resolveOwnedSource(identity.userId, replay),
        null,
      );
    assertSourceWritable(this.database);
    if (this.attachmentImportsInFlight >= 2)
      throw new AppError(
        "ATTACHMENT_IMPORT_BUSY",
        "Attachment import capacity is in use",
        503,
      );
    this.attachmentImportsInFlight += 1;
    let root: string | undefined;
    try {
      root = await mkdtemp(join(this.storageRoot, ".remote-attachment-"));
      const archive = join(root, "source.zip");
      try {
        await downloadAttachment(
          attachment.download_url,
          origins,
          archive,
          this.resourceLimits.maxUploadBytes,
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          "ATTACHMENT_UNAVAILABLE",
          "Could not retrieve the attachment. Attach it again or upload the ZIP directly.",
          409,
        );
      }
      const validated = await validateAndExtract(
        archive,
        join(root, "inspection"),
        this.sources.zipLimits(),
        "",
      );
      let accepted: string | undefined;
      const source = await this.sources
        .storeReadySourceArchive(
          identity.userId,
          archive,
          validated.paths,
          (sourceId) => {
            const timestamp = nowIso();
            accepted = this.findOperationRequest(
              identity.userId,
              request,
              timestamp,
            );
            if (accepted !== undefined && accepted !== sourceId)
              throw new AppError(
                "ATTACHMENT_REPLAY",
                "The attachment was already accepted",
                409,
              );
            if (accepted === undefined)
              this.recordOperationRequest(
                identity.userId,
                request,
                sourceId,
                timestamp,
              );
          },
        )
        .catch((error: unknown) => {
          if (
            error instanceof AppError &&
            error.code === "ATTACHMENT_REPLAY" &&
            accepted !== undefined
          )
            return this.sources.resolveOwnedSource(identity.userId, accepted);
          throw error;
        });
      return this.summarizeSource(source, null);
    } finally {
      try {
        if (root !== undefined)
          await rm(root, { recursive: true, force: true });
      } finally {
        this.attachmentImportsInFlight -= 1;
      }
    }
  }

  async requestAttachedPdfInspection(
    identity: RemoteMcpIdentity,
    attachment: { download_url: string; file_id: string },
    idempotencyKey: string,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const origins = attachmentOrigins(process.env.REMOTE_MCP_FILE_ORIGINS);
    if (origins.size === 0)
      throw new AppError(
        "ATTACHMENT_UNSUPPORTED",
        "Attachment import is not configured for this connection",
        501,
      );
    assertSourceWritable(this.database);
    if (this.attachmentImportsInFlight >= 2)
      throw new AppError(
        "ATTACHMENT_IMPORT_BUSY",
        "Attachment import capacity is in use",
        503,
      );
    const { upload, existing } = this.database.transaction(() =>
      this.database.pdfInspections.reserveUpload(
        identity.userId,
        sha256Hex(idempotencyKey),
        sha256Hex(attachment.file_id),
        nowIso(),
      ),
    );
    if (existing) {
      if (upload.pdf_sha256 === null)
        throw new Error("Existing PDF upload is incomplete");
      const row = this.database.pdfInspections.forUpload(upload);
      if (!row)
        throw new Error("Existing PDF upload is missing its inspection");
      return {
        uploadId: upload.id,
        pdfSha256: upload.pdf_sha256,
        expiresAt: upload.expires_at,
        state: row.status,
        errorCode: row.error_code,
        report: null,
      };
    }
    const directory = pdfInspectionUploadDirectory(this.storageRoot, upload.id);
    const original = join(directory, "original");
    const path = join(original, "result.pdf");
    let created = false;
    this.attachmentImportsInFlight += 1;
    try {
      const parent = dirname(directory);
      await mkdir(parent, { mode: 0o770, recursive: true });
      if ((await realpath(parent)) !== parent)
        throw new Error("Invalid PDF upload directory");
      await mkdir(directory, { mode: 0o770 });
      created = true;
      await mkdir(original, { mode: 0o770 });
      const maxBytes = Math.min(
        this.resourceLimits.maxUploadBytes,
        20 * 1024 ** 2,
      );
      try {
        await downloadAttachment(
          attachment.download_url,
          origins,
          path,
          maxBytes,
          "PDF",
        );
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          "ATTACHMENT_UNAVAILABLE",
          "Could not retrieve the PDF attachment",
          409,
        );
      }
      const pdf = await validateUploadedPdf(path, maxBytes);
      const row = this.database.transaction(() => {
        assertSourceWritable(this.database);
        const timestamp = nowIso();
        const completed = this.database.pdfInspections.completeUpload(
          upload.id,
          pdf.sha256,
          pdf.size,
          timestamp,
        );
        return this.database.pdfInspections.requestUpload(completed, timestamp);
      });
      return {
        uploadId: upload.id,
        pdfSha256: pdf.sha256,
        expiresAt: upload.expires_at,
        state: row.status,
        errorCode: row.error_code,
        report: null,
      };
    } catch (error) {
      if (created) {
        await rm(path, { force: true });
        await rmdir(original).catch((failure: unknown) => {
          if ((failure as NodeJS.ErrnoException).code !== "ENOENT")
            throw failure;
        });
        await rmdir(directory);
      }
      this.database.pdfInspections.discardUpload(upload.id);
      throw error;
    } finally {
      this.attachmentImportsInFlight -= 1;
    }
  }

  async attachedPdfInspection(
    identity: RemoteMcpIdentity,
    uploadId: string,
    sha256: string,
    crop?: PdfCropRequest,
  ) {
    requireScope(identity.scopes, "mcp:read");
    const lookup = () => {
      const upload = this.database.pdfInspections.upload(uploadId);
      if (
        !upload ||
        upload.user_id !== identity.userId ||
        upload.pdf_sha256 === null
      )
        throw new AppError(
          "PDF_UPLOAD_NOT_FOUND",
          "The uploaded PDF is unavailable",
          404,
        );
      if (upload.expires_at <= nowIso())
        throw new AppError(
          "PDF_INSPECTION_EXPIRED",
          "The uploaded PDF has expired",
          410,
        );
      if (upload.pdf_sha256 !== sha256)
        throw new AppError(
          "PDF_CHECKSUM_MISMATCH",
          "The attached PDF does not match the requested digest",
          409,
        );
      return upload;
    };
    const row = crop
      ? this.database.transaction(() => {
          const upload = lookup();
          const params = pdfCropRequestSchema.parse(crop);
          return (
            this.database.pdfInspections.forUpload(upload, params) ??
            this.database.pdfInspections.requestUpload(upload, nowIso(), params)
          );
        })
      : this.database.pdfInspections.forUpload(lookup());
    const upload = lookup();
    let report: unknown = null;
    if (row?.status === "ready") {
      const directory = pdfInspectionUploadDirectory(
        this.storageRoot,
        upload.id,
      );
      try {
        if ((await realpath(directory)) !== directory)
          throw new Error("Invalid PDF upload directory");
        report = await readUploadedPdfInspection(
          pdfInspectionUploadResult(directory, row.id),
        );
      } catch {
        throw new AppError(
          "PDF_INSPECTION_UNAVAILABLE",
          "The PDF inspection report is unavailable",
          410,
        );
      }
      lookup();
    }
    return {
      uploadId: upload.id,
      pdfSha256: sha256,
      expiresAt: upload.expires_at,
      state: row?.status ?? ("not_requested" as const),
      errorCode: row?.error_code ?? null,
      report,
    };
  }

  async createSource(
    identity: RemoteMcpIdentity,
    files: readonly RemoteSourceFileInput[],
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    const limits = directSourceLimits(this.resourceLimits);
    if (files.length < 1 || files.length > limits.files)
      throw new AppError(
        "SOURCE_FILE_COUNT",
        `A direct Source must contain between 1 and ${limits.files} files`,
        400,
      );
    const seen = new Set<string>(),
      prepared: Array<{ path: string; bytes: Buffer }> = [];
    let totalBytes = 0;
    for (const file of files) {
      const path = validateSourceFilePath(file.path),
        duplicateKey = path.normalize("NFC").toLowerCase();
      if (seen.has(duplicateKey))
        throw new AppError(
          "SOURCE_DUPLICATE_PATH",
          "Source contains a duplicate normalized path",
          422,
        );
      seen.add(duplicateKey);
      if ((file.text === undefined) === (file.base64 === undefined))
        throw new AppError(
          "SOURCE_FILE_CONTENT",
          "Each Source file must contain exactly one of text or base64",
          400,
        );
      const bytes =
        file.text === undefined
          ? decodeSourceBase64(file.base64 as string)
          : Buffer.from(file.text, "utf8");
      if (bytes.byteLength > limits.fileBytes)
        throw new AppError(
          "SOURCE_FILE_SIZE",
          `A direct Source file exceeds the ${limits.fileBytes}-byte limit`,
          400,
        );
      totalBytes += bytes.byteLength;
      if (totalBytes > limits.contentBytes)
        throw new AppError(
          "SOURCE_TOTAL_SIZE",
          `Direct Source content exceeds the ${limits.contentBytes}-byte limit`,
          400,
        );
      prepared.push({ path, bytes });
    }
    prepared.sort((left, right) => left.path.localeCompare(right.path));
    assertTexSource(prepared.map((file) => file.path));
    const archive = await zipFiles(prepared, this.sources.zipLimits());
    const source = await this.validateAndStoreSource(identity.userId, archive);
    return this.summarizeSource(source, null);
  }

  private async validateAndStoreSource(
    userId: string,
    archive: Buffer,
  ): Promise<SourceRow> {
    if (archive.byteLength > this.resourceLimits.maxUploadBytes)
      throw new AppError(
        "SOURCE_ARCHIVE_SIZE",
        "Source archive exceeds the configured upload limit",
        422,
      );
    const archiveRoot = await mkdtemp(
      join(this.storageRoot, ".remote-direct-"),
    );
    try {
      const archivePath = join(archiveRoot, "source.zip");
      await writeFile(archivePath, archive, { flag: "wx", mode: 0o660 });
      const verified = await validateAndExtract(
          archivePath,
          join(archiveRoot, "inspection"),
          this.sources.zipLimits(),
          "",
        ),
        source = await this.sources.storeReadySource(
          userId,
          archive,
          verified.paths,
        );
      return source;
    } finally {
      await rm(archiveRoot, { recursive: true, force: true });
    }
  }

  projectStorageUsage(identity: RemoteMcpIdentity, projectId: string) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectStorage(this.database).usage(
      this.projectActor(identity),
      projectId,
      this.maxUserStorageBytes,
    );
  }

  protectSavedRevision(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    value: boolean,
  ) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectStorage(this.database).protect(
      this.projectActor(identity),
      projectId,
      revisionId,
      value,
    );
  }

  planRevisionCleanup(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionIds: string[],
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectStorage(this.database).cleanupPlan(
      this.projectActor(identity),
      projectId,
      revisionIds,
    );
  }

  applyRevisionCleanup(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionIds: string[],
    planHash: string,
  ) {
    requireScope(identity.scopes, "mcp:delete");
    return new ProjectStorage(this.database).applyCleanup(
      this.projectActor(identity),
      projectId,
      revisionIds,
      planHash,
    );
  }

  projectDocumentState(
    identity: RemoteMcpIdentity,
    projectId: string,
    conditionsVersion?: number,
    history?: { revisionId: string; offset?: number | undefined },
  ) {
    requireScope(identity.scopes, "mcp:read");
    const state = new ProjectDocumentState(this.database);
    const actor = this.projectActor(identity);
    return {
      ...state.get(actor, projectId, conditionsVersion),
      revisionChanges:
        history === undefined
          ? null
          : state.revisionChanges(
              actor,
              projectId,
              history.revisionId,
              history.offset ?? 0,
            ),
    };
  }

  updateProjectDocumentConditions(
    identity: RemoteMcpIdentity,
    projectId: string,
    expectedVersion: number,
    entries: ProjectDocumentCondition[],
  ) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectDocumentState(this.database).updateConditions(
      this.projectActor(identity),
      projectId,
      expectedVersion,
      entries,
    );
  }

  adoptProjectRevision(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string | null,
    expectedRevisionId: string | null,
  ) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectDocumentState(this.database).adopt(
      this.projectActor(identity),
      projectId,
      revisionId,
      expectedRevisionId,
    );
  }

  recordProjectPdfReview(
    identity: RemoteMcpIdentity,
    projectId: string,
    input: {
      revisionId: string;
      jobId: string;
      pdfSha256: string;
      conditionsVersion: number | null;
      checks: ProjectReviewCheck[];
      guideVersion: string | null;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectDocumentState(this.database).recordReview(
      this.projectActor(identity),
      projectId,
      input,
      this.artifactRetentionHours,
    );
  }

  projectPdfReviews(
    identity: RemoteMcpIdentity,
    projectId: string,
    offset?: number,
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectDocumentState(this.database).reviews(
      this.projectActor(identity),
      projectId,
      offset,
    );
  }

  getSharedDraft(identity: RemoteMcpIdentity, projectId: string) {
    requireScope(identity.scopes, "mcp:read");
    return this.draftFiles.getDraft(this.projectActor(identity), projectId);
  }

  async startSharedDraft(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId?: string,
    replaceVersion?: number,
  ) {
    requireScope(identity.scopes, "mcp:render");
    return this.draftFiles.openSharedDraft(
      this.projectActor(identity), projectId, revisionId, replaceVersion,
    );
  }

  async getSharedDraftText(
    identity: RemoteMcpIdentity,
    projectId: string,
    version: number,
    path: string,
    offset = 0,
  ) {
    requireScope(identity.scopes, "mcp:read");
    return this.draftFiles.readDraftPage(
      this.projectActor(identity),
      projectId,
      version,
      path,
      offset,
    );
  }

  async applyProjectChanges(identity: RemoteMcpIdentity, input: DraftChangeBatch) {
    requireScope(identity.scopes, "mcp:render");
    return this.draftFiles.applyProjectChanges(this.projectActor(identity), input);
  }

  queueSharedDraftPreview(
    identity: RemoteMcpIdentity,
    projectId: string,
    version: number,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const actor = this.projectActor(identity);
    const principal = this.ensurePrincipal(actor.userId);
    return this.draftOperations().queuePreview(actor, projectId, version, {
      ...this.registrationLimits,
      apiKeyId: principal.api_key_id,
      serviceAccountId: principal.service_account_id,
      runtime: process.env.RENDERER_IMAGE ?? null,
      retentionHours: this.artifactRetentionHours,
    });
  }

  async persistSharedDraft(
    identity: RemoteMcpIdentity,
    projectId: string,
    version: number,
    displayName: string,
    description?: string,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const revision = await this.draftFiles.saveDraftRevision(
      this.projectActor(identity),
      projectId,
      version,
      displayName,
      undefined,
      description,
    );
    return {
      id: revision.id,
      projectId,
      sourceId: revision.source_id,
      revisionNumber: revision.revision_number,
      entrypoint: revision.entrypoint,
      outputs: this.database.projects.renderOutputs(revision),
      engine: revision.engine,
    };
  }

  private draftOperations() {
    return new ProjectDraftOperations(
      this.database,
      this.resourceLimits.maxFileCount,
      this.resourceLimits.maxZipEntries,
    );
  }

  async beginSourceUpload(
    identity: RemoteMcpIdentity,
    expectedBytes: number,
    sha256: string,
  ): Promise<RemoteSourceUpload> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    if (
      !Number.isSafeInteger(expectedBytes) ||
      expectedBytes < 1 ||
      expectedBytes > this.resourceLimits.maxUploadBytes
    )
      throw new AppError(
        "SOURCE_UPLOAD_SIZE",
        `Source upload size must be between 1 byte and ${this.resourceLimits.maxUploadBytes} bytes`,
        400,
      );
    if (!/^[a-f0-9]{64}$/.test(sha256))
      throw new AppError(
        "SOURCE_UPLOAD_HASH",
        "Source upload SHA-256 is invalid",
        400,
      );
    const existing = this.database.sources.findReady(
      identity.userId,
      sha256,
      expectedBytes,
      nowIso(),
    );
    if (existing !== undefined)
      return {
        uploadId: existing.id,
        sourceId: existing.id,
        expectedBytes,
        receivedBytes: expectedBytes,
        expiresAt: existing.expires_at,
        maxChunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
      };
    const sourceId = newId("source"),
      storageKey = `sources/${sourceId}/source.zip`,
      path = join(this.storageRoot, storageKey),
      timestamp = nowIso(),
      expiresAt = new Date(Date.now() + SOURCE_UPLOAD_MS).toISOString();
    this.database.transaction(() => {
      this.sources.assertStorageQuota(identity.userId, expectedBytes);
      assertSourceWritable(this.database);
      this.database.sources.insertReserved({
        id: sourceId,
        ownerUserId: identity.userId,
        size: expectedBytes,
        sha256,
        storageKey,
        timestamp,
        expiresAt,
        dedupeEligible: false,
      });
    });
    try {
      await mkdir(dirname(path), { recursive: true, mode: 0o770 });
      await writeFile(path, Buffer.alloc(0), { flag: "wx", mode: 0o660 });
      // Chunks are immutable, offset-addressed files.  They prevent a writer
      // whose DB lease expired mid-I/O from overwriting a newer writer's bytes.
      await mkdir(join(dirname(path), ".chunks"), { mode: 0o770 });
      this.database.transaction(() => {
        assertSourceWritable(this.database);
        this.database.sources.transitionBeforeExpiry(
          sourceId,
          ["reserved"],
          "uploading",
          nowIso(),
        );
      });
    } catch (error) {
      await rm(dirname(path), { recursive: true, force: true });
      this.database.transaction(() => {
        this.database.sources.discardReservation(sourceId);
      });
      throw error;
    }
    return {
      uploadId: sourceId,
      sourceId,
      expectedBytes,
      receivedBytes: 0,
      expiresAt,
      maxChunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
    };
  }

  sourceUploadStatus(identity: RemoteMcpIdentity, uploadId: string) {
    requireScope(identity.scopes, "mcp:render");
    const source = this.database.sources.getVisible(uploadId);
    if (source?.owner_user_id !== identity.userId)
      throw new AppError(
        "SOURCE_NOT_FOUND",
        "Source upload does not exist",
        404,
      );
    const now = nowIso();
    const ready = this.database.sources.getOwnedReady(
      uploadId,
      identity.userId,
      now,
    );
    const status =
      ready !== undefined
        ? "ready"
        : source.status !== "deleted" &&
            source.status !== "deleting" &&
            source.expires_at <= now
          ? "expired"
          : source.status;
    return {
      ...uploadProgress(
        source,
        status === "ready" ? source.size : source.upload_received_bytes,
      ),
      status,
    };
  }

  async uploadSourceChunk(
    identity: RemoteMcpIdentity,
    uploadId: string,
    offset: number,
    base64: string,
  ): Promise<RemoteSourceUpload> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    return this.appendSourceChunk(identity.userId, uploadId, offset, base64);
  }

  async finalizeSourceUpload(
    identity: RemoteMcpIdentity,
    uploadId: string,
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    return this.completeSourceUpload(identity.userId, uploadId);
  }

  async updateSourceFile(
    identity: RemoteMcpIdentity,
    sourceId: string,
    file: RemoteSourceFileInput,
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    const path = validateSourceFilePath(file.path);
    if ((file.text === undefined) === (file.base64 === undefined))
      throw new AppError(
        "SOURCE_FILE_CONTENT",
        "Source file must contain exactly one of text or base64",
        400,
      );
    const bytes =
      file.text === undefined
        ? decodeSourceBase64(file.base64 as string)
        : Buffer.from(file.text, "utf8");
    const maxRevisionFileBytes = Math.min(
      20 * 1024 * 1024,
      this.resourceLimits.maxUploadBytes,
    );
    if (bytes.byteLength > maxRevisionFileBytes)
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Source file exceeds the configured revision file limit",
        400,
      );
    return this.reviseSource(identity.userId, sourceId, async (root) => {
      const target = join(root, ...path.split("/"));
      await mkdir(dirname(target), { recursive: true, mode: 0o770 });
      await writeFile(target, bytes, { mode: 0o660 });
    });
  }

  async deleteSourceFile(
    identity: RemoteMcpIdentity,
    sourceId: string,
    filePath: string,
  ): Promise<RemoteSourceSummary> {
    requireScope(identity.scopes, "mcp:render");
    assertSourceWritable(this.database);
    const path = validateSourceFilePath(filePath);
    return this.reviseSource(identity.userId, sourceId, async (root) => {
      const target = join(root, ...path.split("/"));
      try {
        const current = await stat(target);
        if (!current.isFile()) throw new Error("not a file");
      } catch {
        throw new AppError(
          "SOURCE_FILE_NOT_FOUND",
          "Source file does not exist",
          404,
        );
      }
      await rm(target, { force: true });
    });
  }

  private projectActor(identity: RemoteMcpIdentity) {
    return { userId: identity.userId, type: "oauth", id: identity.userId };
  }

  private projectReader(identity: RemoteMcpIdentity) {
    return {
      ...this.projectActor(identity),
      jobReader: {
        kind: "mcp" as const,
        serviceAccountId:
          this.database.remoteMcp.principal(identity.userId)
            ?.service_account_id ?? null,
      },
    };
  }

  listProjects(
    identity: RemoteMcpIdentity,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectOperations(this.database).list(
      this.projectActor(identity),
      options,
    );
  }

  getProject(
    identity: RemoteMcpIdentity,
    projectId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectOperations(this.database).get(
      this.projectReader(identity),
      projectId,
      options,
    );
  }

  private savedRevisionSource(identity: RemoteMcpIdentity, projectId: string, revisionId: string) {
    requireScope(identity.scopes, "mcp:read");
    return this.savedSources().revisionSource(this.projectActor(identity), projectId, revisionId);
  }

  private savedSources() {
    return new RendererSavedSources(this.database, this.sources);
  }

  projectDelivery(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    jobId?: string,
  ) {
    const { source, revision, entrypoint, engine } = this.savedRevisionSource(
      identity,
      projectId,
      revisionId,
    );
    const url = (path: string) =>
      new URL(`/app/api/v1/${path}`, this.publicOrigin).href;
    const sourceZip = {
      size: source.size,
      sha256: source.sha256,
      filename: `${revisionId}.zip`,
      availability: "available" as const,
      mimeType: "application/zip",
      downloadUrl: url(
        `projects/${projectId}/revisions/${revisionId}/source.zip`,
      ),
    };
    if (jobId === undefined) return { ...revision, sourceZip, pdf: null };
    const job = this.assertReadableJob(identity.userId, jobId);
    if (
      job.project_revision_id !== revisionId ||
      job.source_id !== source.id ||
      job.source_sha256 !== source.sha256 ||
      job.entrypoint !== entrypoint ||
      job.engine !== engine
    )
      throw new AppError(
        "DELIVERY_TARGET_MISMATCH",
        "The Job does not match the requested saved Source and revision",
        409,
      );
    const pdf = this.database.artifacts.getDownloadable(jobId, "result.pdf", {
      retentionHours: this.artifactRetentionHours,
    });
    const expiresAt =
      pdf !== undefined || job.completed_at !== null
        ? this.artifactExpiry(job)
        : null;
    return {
      ...revision,
      sourceZip,
      pdf:
        pdf === undefined
          ? {
              jobId,
              availability:
                job.status === "expired" ||
                (expiresAt !== null && expiresAt <= nowIso())
                  ? ("expired" as const)
                  : ["queued", "validating", "running"].includes(job.status)
                    ? ("pending" as const)
                    : ("unavailable" as const),
              status: job.status,
            }
          : {
              jobId,
              availability: "available" as const,
              status: job.status,
              size: pdf.size,
              sha256: pdf.sha256,
              filename: "result.pdf",
              mimeType: "application/pdf",
              expiresAt: this.artifactExpiry(job),
              inlineMaxBytes: this.maxInlineArtifactBytes,
              manifestResourceUri: `latex-renderer://jobs/${jobId}/manifest/${pdf.sha256}`,
              downloadUrl: url(`jobs/${jobId}/artifacts/result.pdf`),
              resourceUri:
                pdf.size <= this.maxInlineArtifactBytes
                  ? resourceUri(jobId, "result.pdf")
                  : null,
            },
    };
  }

  listProjectRevisionFiles(identity: RemoteMcpIdentity, projectId: string, revisionId: string, offset = 0, limit = 25) {
    requireScope(identity.scopes, "mcp:read");
    return this.savedSources().listProjectRevisionFiles(this.projectActor(identity), projectId, revisionId, offset, limit);
  }

  getProjectRevisionFile(identity: RemoteMcpIdentity, projectId: string, revisionId: string, path: string, offset = 0) {
    requireScope(identity.scopes, "mcp:read");
    return this.savedSources().getProjectRevisionFile(this.projectActor(identity), projectId, revisionId, path, offset);
  }

  projectRevisionJobs(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    requireScope(identity.scopes, "mcp:read");
    return new ProjectOperations(this.database).jobs(
      this.projectReader(identity),
      projectId,
      revisionId,
      options,
    );
  }

  createProject(identity: RemoteMcpIdentity, displayName: string) {
    requireScope(identity.scopes, "mcp:render");
    return new ProjectOperations(this.database).create(
      this.projectActor(identity),
      displayName,
    );
  }

  renameProject(
    identity: RemoteMcpIdentity,
    projectId: string,
    displayName: string,
  ) {
    requireScope(identity.scopes, "mcp:render");
    new ProjectOperations(this.database).rename(
      this.projectActor(identity),
      projectId,
      displayName,
    );
    return { id: projectId, displayName };
  }

  deleteProject(identity: RemoteMcpIdentity, projectId: string) {
    requireScope(identity.scopes, "mcp:delete");
    new ProjectOperations(this.database).delete(
      this.projectActor(identity),
      projectId,
    );
    return { id: projectId, deleted: true as const };
  }

  attachProjectRevision(
    identity: RemoteMcpIdentity,
    input: {
      projectId: string;
      sourceId: string;
      entrypoint: string;
      displayName: string;
      originalFilename: string;
      outputs: Array<"pdf" | "svg">;
      engine?: RenderEngine | undefined;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    const revision = new ProjectOperations(this.database).attachRevision(
      this.projectActor(identity),
      { ...input, entrypoint: validateEntrypointPath(input.entrypoint) },
    );
    return {
      id: revision.id,
      projectId: input.projectId,
      sourceId: revision.source_id,
      revisionNumber: revision.revision_number,
      entrypoint: revision.entrypoint,
      outputs: this.database.projects.renderOutputs(revision),
      engine: revision.engine,
    };
  }

  async updateProjectFile(
    identity: RemoteMcpIdentity,
    input: {
      projectId: string;
      revisionId: string;
      file: RemoteSourceFileInput;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    const path = validateSourceFilePath(input.file.path);
    if ((input.file.text === undefined) === (input.file.base64 === undefined))
      throw new AppError(
        "SOURCE_FILE_CONTENT",
        "Source file must contain exactly one of text or base64",
        400,
      );
    const bytes =
      input.file.text === undefined
        ? decodeSourceBase64(input.file.base64 as string)
        : Buffer.from(input.file.text, "utf8");
    if (
      bytes.byteLength >
      Math.min(20 * 1024 * 1024, this.resourceLimits.maxUploadBytes)
    )
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Source file exceeds the configured revision file limit",
        400,
      );
    return this.reviseProjectFile(
      identity,
      input.projectId,
      input.revisionId,
      async (root) => {
        const target = join(root, ...path.split("/"));
        await mkdir(dirname(target), { recursive: true, mode: 0o770 });
        await writeFile(target, bytes, { mode: 0o660 });
      },
    );
  }

  async deleteProjectFile(
    identity: RemoteMcpIdentity,
    input: {
      projectId: string;
      revisionId: string;
      path: string;
    },
  ) {
    requireScope(identity.scopes, "mcp:render");
    const path = validateSourceFilePath(input.path);
    return this.reviseProjectFile(
      identity,
      input.projectId,
      input.revisionId,
      async (root) => {
        const target = join(root, ...path.split("/"));
        const current = await stat(target).catch(() => undefined);
        if (current === undefined || !current.isFile())
          throw new AppError(
            "SOURCE_FILE_NOT_FOUND",
            "Source file does not exist",
            404,
          );
        await rm(target);
      },
    );
  }

  private async reviseProjectFile(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    mutation: (root: string) => Promise<void>,
  ) {
    const projects = new ProjectOperations(this.database),
      selected = projects.revision(
        this.projectActor(identity),
        projectId,
        revisionId,
      );
    let projectRevision:
      ReturnType<ProjectOperations["attachRevisionInTransaction"]> | undefined;
    const source = await this.reviseSource(
      identity.userId,
      selected.revision.source_id,
      mutation,
      (sourceId) => {
        projectRevision = projects.attachRevisionInTransaction(
          this.projectActor(identity),
          {
            projectId,
            sourceId,
            entrypoint: selected.revision.entrypoint,
            displayName: selected.revision.display_name,
            originalFilename: selected.revision.original_filename,
            outputs: this.database.projects.renderOutputs(selected.revision),
            engine: selected.revision.engine,
          },
        );
      },
    );
    if (projectRevision === undefined)
      throw new AppError(
        "PROJECT_REVISION_MISSING",
        "Project revision was not attached",
        500,
      );
    return {
      source,
      revision: {
        id: projectRevision.id,
        projectId,
        sourceId: projectRevision.source_id,
        revisionNumber: projectRevision.revision_number,
        entrypoint: projectRevision.entrypoint,
        outputs: this.database.projects.renderOutputs(projectRevision),
        engine: projectRevision.engine,
      },
    };
  }

  async renderProjectRevision(
    identity: RemoteMcpIdentity,
    projectId: string,
    revisionId: string,
    outputs?: Array<"pdf" | "svg">,
    idempotencyKey?: string,
    reproducibility?: RenderReproducibility,
  ) {
    requireScope(identity.scopes, "mcp:render");
    const request = operationRequest(
      "remote_mcp.render_project_revision",
      idempotencyKey,
      {
        projectId,
        revisionId,
        outputs,
        reproducibility,
      },
    );
    const replay = this.findRenderRequest(identity.userId, request, nowIso());
    if (replay) return this.summarize(replay);
    const projects = new ProjectOperations(this.database),
      selected = projects.revision(
        this.projectActor(identity),
        projectId,
        revisionId,
      );
    return this.queueRender(
      identity,
      {
        sourceId: selected.revision.source_id,
        entrypoint: selected.revision.entrypoint,
        outputs: outputs ?? projects.renderOutputs(selected.revision),
        engine: selected.revision.engine,
        reproducibility,
        project: { projectId, revisionId },
      },
      request,
    );
  }

  async createRender(
    identity: RemoteMcpIdentity,
    input: RenderInput,
    idempotencyKey?: string,
  ): Promise<RemoteJobSummary> {
    requireScope(identity.scopes, "mcp:render");
    const request = operationRequest(
      "remote_mcp.create_render",
      idempotencyKey,
      {
        ...("inlineSource" in input
          ? { inlineSourceHash: sha256Hex(input.inlineSource) }
          : "sourceRef" in input
            ? { sourceRef: input.sourceRef }
            : { sourceId: input.sourceId, project: input.project }),
        entrypoint: input.entrypoint,
        outputs: input.outputs,
        engine: input.engine,
        reproducibility: input.reproducibility,
      },
    );
    return this.queueRender(identity, input, request);
  }

  private async queueRender(
    identity: RemoteMcpIdentity,
    input: RenderInput,
    request: OperationRequest | undefined,
  ): Promise<RemoteJobSummary> {
    const replay = this.findRenderRequest(identity.userId, request, nowIso());
    if (replay) return this.summarize(replay);
    assertRenderAvailable(this.database);
    const entrypoint = validateEntrypointPath(input.entrypoint ?? "main.tex"),
      outputs = normalizeRenderOutputs(input.outputs),
      engine = input.engine ?? defaultRenderEngine,
      dateProfile = input.reproducibility,
      fixedEpoch =
        dateProfile?.mode === "fixed"
          ? Math.floor(Date.parse(dateProfile.date) / 1000)
          : null;
    if (dateProfile && engine !== "lualatex")
      throw new AppError(
        "DATE_PROFILE_UNSUPPORTED",
        "The date profile requires LuaLaTeX",
        422,
      );
    if (
      fixedEpoch !== null &&
      (!Number.isSafeInteger(fixedEpoch) || fixedEpoch < 0)
    )
      throw new AppError(
        "DATE_PROFILE_INVALID",
        "Use a valid UTC date on or after the Unix epoch",
        422,
      );
    const principal = this.ensurePrincipal(identity.userId),
      source =
        "sourceRef" in input
          ? this.resolveSourceRef(identity.userId, input.sourceRef)
          : "sourceId" in input
            ? this.sources.resolveOwnedSource(identity.userId, input.sourceId)
            : await this.createInlineSource(
                identity.userId,
                input.inlineSource,
                entrypoint,
              );
    assertRenderEntrypoint(this.database, source, entrypoint);
    const acceptedId = this.database.transaction(() => {
      const timestamp = nowIso();
      const replay = this.findRenderRequest(
        identity.userId,
        request,
        timestamp,
      );
      if (replay) return replay.id;
      const jobId = newId("job");
      registerReadyRender(this.database, this.registrationLimits, {
        id: jobId,
        userId: identity.userId,
        serviceAccountId: principal.service_account_id,
        apiKeyId: principal.api_key_id,
        actor: this.projectActor(identity),
        action: "remote_mcp.render.queued",
        sourceId: source.id,
        entrypoint,
        outputs,
        engine,
        project: "project" in input ? input.project : undefined,
        timestamp,
      });
      if (dateProfile)
        this.database.jobs.setReproducibility(
          jobId,
          dateProfile.mode,
          fixedEpoch ?? Math.floor(Date.parse(timestamp) / 1000),
        );
      this.recordOperationRequest(identity.userId, request, jobId, timestamp);
      return jobId;
    });
    const created = this.database.jobs.get(acceptedId);
    if (created === undefined)
      throw new AppError("JOB_CREATE_FAILED", "Render job was not created");
    return this.summarize(created);
  }

  retryRender(
    identity: RemoteMcpIdentity,
    jobId: string,
    idempotencyKey?: string,
  ): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:render");
    const request = operationRequest(
      "remote_mcp.retry_render",
      idempotencyKey,
      {
        jobId,
      },
    );
    const acceptedId = this.database.transaction(() => {
      const timestamp = nowIso();
      const replay = this.findRenderRequest(
        identity.userId,
        request,
        timestamp,
      );
      if (replay) return replay.id;
      const previous = this.assertOwned(identity.userId, jobId);
      const retryId = registerWholeRenderRetry(
        this.database,
        this.registrationLimits,
        {
          originalId: previous.id,
          timestamp,
          notRetryable: "Only a terminal Job can be retried",
          sourceUnavailable: (sourceId) =>
            new AppError(
              "SOURCE_NOT_READY",
              sourceId === null
                ? "The previous Job has no reusable Source"
                : "The previous Job Source is not ready",
              409,
            ),
        },
      );
      this.database.audit({
        actorType: "oauth",
        actorId: identity.userId,
        action: "remote_mcp.render.retried",
        targetType: "job",
        targetId: retryId,
        result: "success",
        metadata: { retryOf: previous.id, sourceId: previous.source_id },
      });
      this.recordOperationRequest(identity.userId, request, retryId, timestamp);
      return retryId;
    });
    const retry = this.database.jobs.get(acceptedId);
    if (retry === undefined)
      throw new AppError("JOB_CREATE_FAILED", "Retry Job was not created");
    return this.summarize(retry);
  }

  private findOperationRequest(userId: string, request: OperationRequest | undefined, timestamp: string) {
    return findOperationRequest(this.database, { type: "oauth", id: userId }, request, timestamp);
  }

  private findRenderRequest(
    userId: string,
    request: OperationRequest | undefined,
    timestamp: string,
  ): JobRow | undefined {
    const jobId = this.findOperationRequest(userId, request, timestamp);
    return jobId === undefined ? undefined : this.assertOwned(userId, jobId);
  }

  private recordOperationRequest(userId: string, request: OperationRequest | undefined, resourceId: string, timestamp: string) {
    recordOperationRequest(this.database, { type: "oauth", id: userId }, request, resourceId, timestamp);
  }

  retrySvgRender(
    identity: RemoteMcpIdentity,
    jobId: string,
    idempotencyKey: string,
  ): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:render");
    const previous = this.assertOwned(identity.userId, jobId);
    new SvgRetryOperations(this.database, {
      ...this.registrationLimits,
      artifactRetentionHours: this.artifactRetentionHours,
      runtimeImage: process.env.RENDERER_IMAGE,
    }).retry(
      {
        userId: identity.userId,
        type: "oauth",
        id: identity.userId,
        serviceAccountId: previous.service_account_id,
      },
      jobId,
      idempotencyKey,
    );
    const row = this.database.jobs.get(jobId);
    if (!row) throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return this.summarize(row);
  }

  job(identity: RemoteMcpIdentity, jobId: string): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:read");
    return this.summarize(this.assertReadableJob(identity.userId, jobId));
  }

  pdfInspection(
    identity: RemoteMcpIdentity,
    jobId: string,
    sha256: string,
    request = false,
    params?: PdfInspectionInput,
  ) {
    requireScope(identity.scopes, "mcp:read");
    return inspectJobPdf(this.database, jobId, sha256, {
      readJob: () => this.assertReadableJob(identity.userId, jobId),
      sources: this.sources,
      retentionHours: this.artifactRetentionHours,
      request,
      params,
    });
  }

  comparePdfInspections(
    identity: RemoteMcpIdentity,
    before: { jobId: string; pdfSha256: string },
    after: { jobId: string; pdfSha256: string },
  ) {
    const left = this.pdfInspection(identity, before.jobId, before.pdfSha256);
    const right = this.pdfInspection(identity, after.jobId, after.pdfSha256);
    const observations = (value: unknown) => {
      if (typeof value !== "object" || value === null || !("checks" in value))
        return {};
      return value.checks as Record<
        string,
        { text: string | null; truncated: boolean }
      >;
    };
    const leftChecks = observations(left.report),
      rightChecks = observations(right.report);
    const compare = (name: string) => {
      const a = leftChecks[name],
        b = rightChecks[name];
      if (
        !a ||
        !b ||
        a.text === null ||
        b.text === null ||
        a.truncated ||
        b.truncated
      )
        return "not_checked" as const;
      return a.text === b.text
        ? ("same_observation" as const)
        : ("changed_observation" as const);
    };
    const rasterVersion = compare("versions");
    const pageRasters = (checks: ReturnType<typeof observations>) => {
      const sample = checks["page-rasters"];
      if (sample?.text == null || sample.truncated) return [];
      return sample.text
        .trim()
        .split("\n")
        .filter((hash) => /^[a-f0-9]{64}$/.test(hash));
    };
    const leftPages = pageRasters(leftChecks),
      rightPages = pageRasters(rightChecks);
    const comparedPages =
      rasterVersion === "same_observation"
        ? Math.min(leftPages.length, rightPages.length)
        : 0;
    const changedPreviewPages = Array.from(
      { length: comparedPages },
      (_, i) => i + 1,
    ).filter((page) => leftPages[page - 1] !== rightPages[page - 1]);
    const leftJob = this.assertReadableJob(identity.userId, before.jobId);
    const rightJob = this.assertReadableJob(identity.userId, after.jobId);
    return {
      before: { ...before, revisionId: left.revisionId, state: left.state },
      after: { ...after, revisionId: right.revisionId, state: right.state },
      samePdfBytes: left.pdfSha256 === right.pdfSha256,
      extractedText: compare("extracted-text"),
      fontInventory: compare("font-info"),
      pageInfoAndMetadata: compare("page-info"),
      navigation: compare("navigation"),
      visual:
        comparedPages === 0
          ? ("not_checked" as const)
          : changedPreviewPages.length > 0
            ? ("changed_observation" as const)
            : ("same_observation" as const),
      visualCoverage: {
        comparedPages,
        changedPreviewPages,
        maxPageSidePixels: 512,
        pagePairing: "physical_page_number" as const,
      },
      sourceComparison:
        leftJob.source_id !== null && rightJob.source_id !== null
          ? leftJob.source_sha256 === rightJob.source_sha256 &&
            leftJob.entrypoint === rightJob.entrypoint
            ? ("same_observation" as const)
            : ("changed_observation" as const)
          : ("not_checked" as const),
      documentMeaning: "not_checked" as const,
      sameEngine: leftJob.engine === rightJob.engine,
      sameRuntime:
        leftJob.runtime_digest === null || rightJob.runtime_digest === null
          ? null
          : leftJob.runtime_digest === rightJob.runtime_digest,
    };
  }

  renderManifest(identity: RemoteMcpIdentity, jobId: string) {
    requireScope(identity.scopes, "mcp:read");
    const row = this.assertReadableJob(identity.userId, jobId);
    const summary = this.summarize(row);
    return {
      schemaVersion: 1 as const,
      jobId,
      status: summary.status,
      projectRevisionId: row.project_revision_id,
      sourceId: row.source_id,
      inputSha256: row.source_sha256,
      inputKind: row.source_id
        ? ("source_zip" as const)
        : this.database.drafts.isPreviewJob(jobId)
          ? ("draft_manifest" as const)
          : ("unknown" as const),
      entrypoint: row.entrypoint,
      engine: row.engine,
      runtimeDigest: row.runtime_digest,
      outputs: summary.outputs,
      pdfSha256:
        summary.artifacts.find(
          ({ relativePath }) => relativePath === "result.pdf",
        )?.sha256 ?? null,
      artifacts: summary.artifacts,
      stages: summary.stages ?? null,
      recordedTiming: {
        createdAt: row.created_at,
        queuedAt: row.queued_at,
        startedAt: row.started_at,
        finishedAt: row.completed_at,
      },
      workerObservations: this.database.jobs.stageObservations(jobId),
      reproducibility: this.database.jobs.reproducibility(jobId) ?? null,
      pdfSvgMatch: "not_checked" as const,
    };
  }

  async diagnostics(
    identity: RemoteMcpIdentity,
    jobId: string,
    stage?: "pdf" | "svg",
    offset?: number,
    limit?: number,
  ): Promise<RemoteRenderDiagnostics> {
    requireScope(identity.scopes, "mcp:read");
    const row = this.assertReadableJob(identity.userId, jobId),
      stages = this.database.outputStages.publicState(jobId),
      selectedStage =
        stage ??
        (stages?.pdf.status === "succeeded" &&
        ["failed", "timeout", "canceled"].includes(stages.svg.status)
          ? "svg"
          : "pdf"),
      prefix = selectedStage === "svg" ? "svg/" : "",
      available = this.database.artifacts.listDownloadable(jobId, {
        retentionHours: this.artifactRetentionHours,
      }),
      errorsArtifact = available.find(
        (artifact) => artifact.relative_path === `${prefix}errors.json`,
      ),
      logArtifact = available.find(
        (artifact) => artifact.relative_path === `${prefix}compile.log`,
      ),
      errorsJson =
        errorsArtifact === undefined
          ? undefined
          : (await this.artifact(
              identity, jobId, errorsArtifact.relative_path,
            )).bytes.toString("utf8");
    return renderDiagnostics({
      row,
      stages,
      selectedStage,
      stageWasRequested: stage !== undefined,
      offset,
      limit,
      errorsJson,
      ...(logArtifact === undefined
        ? {}
        : {
            readLog: () => this.logWindow(logArtifact, undefined, undefined, 16_384),
            rawLogResourceUri: logArtifact.size > this.maxInlineArtifactBytes
              ? null
              : resourceUri(jobId, logArtifact.relative_path),
          }),
    });
  }

  previewPages(
    identity: RemoteMcpIdentity,
    jobId: string,
    pdfSha256: string,
    requested: number[],
  ) {
    requireScope(identity.scopes, "mcp:read");
    const job = this.assertReadableJob(identity.userId, jobId);
    if (
      requested.length < 1 ||
      requested.length > 8 ||
      new Set(requested).size !== requested.length ||
      requested.some(
        (page) => !Number.isSafeInteger(page) || page < 1 || page > 100,
      )
    )
      throw new AppError(
        "PREVIEW_PAGE_INVALID",
        "Select 1 to 8 distinct PDF pages",
        400,
      );
    const policy = { retentionHours: this.artifactRetentionHours };
    return this.database.transaction(() => {
      const pdf = this.database.artifacts.getDownloadable(
        jobId,
        "result.pdf",
        policy,
      );
      if (!pdf)
        throw new AppError(
          "PDF_UNAVAILABLE",
          "The canonical PDF is not available",
          410,
        );
      if (pdf.sha256 !== pdfSha256)
        throw new AppError(
          "PDF_CHECKSUM_MISMATCH",
          "The canonical PDF does not match the requested digest",
          409,
        );
      const document = this.database.previews.document(jobId);
      const available = this.database.artifacts.listDownloadable(jobId, policy);
      const pages = requested.map((page) => {
        const ready = available.find(
          (artifact) => artifact.relative_path === `previews/page-${page}.png`,
        );
        if (ready)
          return {
            page,
            state: "ready" as const,
            sha256: ready.sha256,
            resourceUri:
              ready.size <= this.maxInlineArtifactBytes
                ? resourceUri(jobId, ready.relative_path)
                : null,
            errorCode: null,
            retryable: false,
          };
        try {
          this.database.previews.request(jobId, page, nowIso(), policy);
          return {
            page,
            state: "pending" as const,
            sha256: null,
            resourceUri: null,
            errorCode: null,
            retryable: true,
          };
        } catch (error) {
          if (!(error instanceof AppError)) throw error;
          const busy = error.code === "PREVIEW_QUEUE_FULL";
          return {
            page,
            state: busy
              ? ("busy" as const)
              : error.code === "PREVIEW_FAILED"
                ? ("failed" as const)
                : ("unavailable" as const),
            sha256: null,
            resourceUri: null,
            errorCode:
              typeof error.details?.previewErrorCode === "string"
                ? error.details.previewErrorCode
                : error.code,
            retryable: busy || error.details?.retryable === true,
          };
        }
      });
      return {
        jobId,
        projectRevisionId: job.project_revision_id,
        pdfSha256,
        pageCount:
          document?.pdf_sha256 === pdf.sha256 ? document.page_count : null,
        pages,
      };
    });
  }

  async relayDownload(
    identity: RemoteMcpIdentity,
    target: RendererRelayDownloadTarget,
    offset: number,
    limit: number,
  ) {
    requireScope(identity.scopes, "mcp:read");
    this.enforceRateLimit(identity.userId, "relay_download", 500);
    const mime =
      target.kind === "source"
        ? "application/zip"
        : target.path === "result.pdf"
          ? "application/pdf"
          : "image/png";
    const readSegment = async (path: string, size: number) => {
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        !Number.isSafeInteger(offset) ||
        offset < 0 ||
        offset > size ||
        !Number.isSafeInteger(limit) ||
        limit < 0 ||
        limit > 512 * 1024
      )
        throw new AppError(
          "INVALID_ARTIFACT_RANGE",
          "Artifact range is invalid",
          416,
        );
      const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const metadata = await file.stat();
        if (!metadata.isFile() || metadata.size !== size)
          throw new AppError(
            "ARTIFACT_UNAVAILABLE",
            "Artifact does not match its stored metadata",
            409,
          );
        const length = Math.min(limit, size - offset),
          bytes = Buffer.alloc(length);
        let received = 0;
        while (received < length) {
          const { bytesRead } = await file.read(
            bytes,
            received,
            length - received,
            offset + received,
          );
          if (bytesRead === 0)
            throw new AppError(
              "ARTIFACT_UNAVAILABLE",
              "Artifact ended before the requested range",
              409,
            );
          received += bytesRead;
        }
        return {
          sha256: target.sha256,
          size,
          offset,
          mimeType: mime,
          data: bytes.toString("base64"),
        };
      } finally {
        await file.close();
      }
    };
    if (target.kind === "source") {
      const { source, path } = this.savedRevisionSource(
        identity,
        target.projectId,
        target.revisionId,
      );
      if (source.sha256 !== target.sha256)
        throw new AppError(
          "ARTIFACT_NOT_FOUND",
          "Artifact does not exist",
          404,
        );
      return readSegment(path, source.size);
    }
    this.assertReadableJob(identity.userId, target.jobId);
    const artifact = this.database.artifacts.getDownloadable(
      target.jobId,
      target.path,
      { retentionHours: this.artifactRetentionHours },
    );
    if (!artifact || artifact.sha256 !== target.sha256)
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    return this.withArtifactLease(artifact, (path) =>
      readSegment(path, artifact.size),
    );
  }

  async artifact(
    identity: RemoteMcpIdentity,
    jobId: string,
    relativePath: string,
  ): Promise<RemoteArtifactContent> {
    requireScope(identity.scopes, "mcp:read");
    this.assertReadableJob(identity.userId, jobId);
    let artifact = this.database.artifacts.getDownloadable(
      jobId,
      relativePath,
      { retentionHours: this.artifactRetentionHours },
    );
    const page = /^previews\/page-[1-9][0-9]*\.png$/.test(relativePath)
      ? previewPage(relativePath)
      : null;
    if (page !== null) {
      const candidates = this.database.artifacts
        .listDownloadable(jobId, {
          retentionHours: this.artifactRetentionHours,
        })
        .filter(
          (item) =>
            item.type === "preview" && previewPage(item.relative_path) === page,
        );
      if (candidates.length > 1)
        throw new AppError("INVALID_PREVIEW", "Preview page is ambiguous", 409);
      artifact =
        candidates[0] ??
        (await waitForPreview(this.database, jobId, page, {
          retentionHours: this.artifactRetentionHours,
        }));
    }
    if (artifact === undefined)
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    if (
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 0 ||
      artifact.size > this.maxInlineArtifactBytes
    )
      throw new AppError(
        "ARTIFACT_TOO_LARGE",
        `Artifact exceeds the ${this.maxInlineArtifactBytes}-byte MCP inline resource limit; use the protected Web result instead`,
        413,
      );
    const release = await this.acquireInlineArtifactBytes(artifact.size);
    try {
      return {
        jobId,
        relativePath: artifact.relative_path,
        mimeType: artifactMimeType(artifact.type),
        size: artifact.size,
        sha256: artifact.sha256,
        bytes: await this.withArtifactLease(artifact, (path, signal) =>
          readBoundedArtifact(
            path,
            artifact.size,
            this.maxInlineArtifactBytes,
            signal,
          ),
        ),
      };
    } finally {
      release();
    }
  }

  async readRenderLog(
    identity: RemoteMcpIdentity,
    jobId: string,
    stage: "pdf" | "svg",
    startByte?: number,
    startLine?: number,
    sha256?: string,
  ) {
    requireScope(identity.scopes, "mcp:read");
    const job = this.assertReadableJob(identity.userId, jobId);
    const path = stage === "svg" ? "svg/compile.log" : "compile.log";
    const artifact = this.database.artifacts.getDownloadable(jobId, path, {
      retentionHours: this.artifactRetentionHours,
    });
    if (artifact === undefined) {
      const stored =
        job.status === "expired" ||
        job.status === "deleted" ||
        job.status === "deleting";
      throw new AppError(
        stored ? "LOG_EXPIRED" : "LOG_NOT_FOUND",
        stored
          ? "The compile log has expired"
          : "The compile log is not available",
        stored ? 410 : 404,
      );
    }
    if (sha256 !== undefined && artifact.sha256 !== sha256)
      throw new AppError(
        "LOG_CHANGED",
        "The stored log changed; start a new read",
        409,
      );
    return {
      jobId,
      stage,
      sha256: artifact.sha256,
      ...(await this.logWindow(artifact, startByte, startLine, 8192)),
    };
  }

  private async logWindow(
    artifact: ArtifactRow,
    startByte: number | undefined,
    startLine: number | undefined,
    maxBytes: number,
  ) {
    assertLogRange(artifact.size, startByte, startLine);
    const release = await this.acquireInlineArtifactBytes(maxBytes);
    try {
      return await this.withArtifactLease(artifact, (path, signal) =>
        readLogWindow(path, signal, artifact.size, startByte, startLine, maxBytes),
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        "LOG_UNAVAILABLE",
        "The stored compile log cannot be read",
        409,
      );
    } finally {
      release();
    }
  }

  private async withArtifactLease<T>(
    artifact: ArtifactRow,
    read: (path: string, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    let releaseLease: (() => void) | undefined;
    try {
      // Admission may wait behind other reads. Recheck retention and register
      // protection together only after the memory budget is actually acquired.
      const leaseId = this.database.transaction(() => {
        const current = this.database.artifacts.getDownloadable(
          artifact.job_id,
          artifact.relative_path,
          { retentionHours: this.artifactRetentionHours },
        );
        if (current === undefined || current.id !== artifact.id)
          throw new AppError(
            "ARTIFACT_NOT_FOUND",
            "Artifact is no longer available",
            404,
          );
        const id = newId("download");
        this.database.artifacts.createLease({
          id,
          jobId: artifact.job_id,
          artifactId: current.id,
          createdAt: nowIso(),
          expiresAt: new Date(
            Date.now() + ARTIFACT_DOWNLOAD_LEASE_MS,
          ).toISOString(),
        });
        return id;
      });
      const controller = new AbortController();
      releaseLease = protectArtifactDownloadLeases(
        this.database.artifacts,
        [leaseId],
        () =>
          controller.abort(
            new AppError(
              "ARTIFACT_UNAVAILABLE",
              "Artifact download protection was lost",
              503,
            ),
          ),
      );
      return await read(this.artifactPath(artifact), controller.signal);
    } finally {
      releaseLease?.();
    }
  }

  capabilities(identity: RemoteMcpIdentity): RemoteRendererCapabilities {
    requireScope(identity.scopes, "mcp:read");
    return this.environment.capabilities();
  }

  verifiedCapabilities(
    identity: RemoteMcpIdentity,
  ): Promise<RemoteRendererCapabilities> {
    requireScope(identity.scopes, "mcp:read");
    return this.environment.verifiedCapabilities();
  }

  async taggedJapaneseProfile(
    identity: RemoteMcpIdentity,
    fixtureSha256: string,
  ) {
    requireScope(identity.scopes, "mcp:read");
    const runtimeDigest = this.capabilities(identity).runtimeDigest;
    let verified = false;
    if (runtimeDigest !== null) {
      try {
        const file = await open(
          join(this.environmentRoot, "authoring-profiles.json"),
          "r",
        );
        try {
          const info = await file.stat();
          if (info.isFile() && info.size <= 4096) {
            const bytes = Buffer.alloc(info.size);
            if ((await file.read(bytes)).bytesRead === info.size) {
              const value = JSON.parse(bytes.toString("utf8")) as {
                schemaVersion?: number;
                runtimeImage?: string;
                profile?: string;
                fixtureSha256?: string;
                machineChecks?: unknown;
              } | null;
              verified =
                value?.schemaVersion === 1 &&
                value.runtimeImage === this.rendererVersion &&
                value.profile === "tagged-ja-v1" &&
                value.fixtureSha256 === fixtureSha256 &&
                Array.isArray(value.machineChecks) &&
                ["pdf-structure", "tagged", "japanese-text"].every((check) =>
                  (value.machineChecks as unknown[]).includes(check),
                );
            }
          }
        } finally {
          await file.close();
        }
      } catch {
        // Missing or stale evidence leaves this profile unavailable.
      }
    }
    return {
      id: "tagged-ja-v1",
      runtimeDigest,
      fixtureSha256,
      engine: "lualatex" as const,
      documentClass: "article",
      state: verified
        ? ("verified_tagged_fixture" as const)
        : ("not_checked" as const),
      guideTopic: "accessibility",
      templateTopic: "japanese-tagged",
      readingOrder: "not_checked" as const,
      pdfUa: "not_checked" as const,
    };
  }

  async documentRequirements(
    identity: RemoteMcpIdentity,
    engine: RenderEngine,
    requirements: readonly DocumentRequirement[],
    revision?: {
      projectId: string;
      revisionId: string;
      inspectEntrypoint?: boolean | undefined;
    },
  ) {
    requireScope(identity.scopes, "mcp:read");
    const saved =
      revision === undefined
        ? null
        : this.savedRevisionSource(
            identity,
            revision.projectId,
            revision.revisionId,
          );
    const entrypoint =
      saved && revision?.inspectEntrypoint
        ? await this.getProjectRevisionFile(
            identity,
            saved.revision.projectId,
            saved.revision.revisionId,
            saved.entrypoint,
          )
        : null;
    const sourceCandidates = entrypoint && {
      path: entrypoint.path,
      sha256: entrypoint.sha256,
      coverage: "literal_entrypoint_declarations" as const,
      ...staticEntrypointRequirements(
        entrypoint.text,
        entrypoint.nextOffset !== null,
      ),
    };
    const capabilities = await this.verifiedCapabilities(identity);
    const inventory = await (this.requirementInventory ??=
      new DocumentRequirementInventory(
        this.environmentRoot,
        this.rendererVersion,
      )).check(requirements);
    return {
      version: 1 as const,
      runtimeDigest: capabilities.runtimeDigest,
      engine,
      engineState: capabilities.engineOutputs?.some(
        (item) => item.engine === engine && item.pdf,
      )
        ? ("verified" as const)
        : ("not_checked" as const),
      inventoryVersion: inventory.inventoryVersion,
      requirementFingerprint: requirementsFingerprint({
        engine,
        requirements,
        saved: saved?.revision ?? null,
        inspectEntrypoint: revision?.inspectEntrypoint === true,
      }),
      revision: saved?.revision ?? null,
      sourceCandidates,
      items: inventory.items,
    };
  }

  documentProbe(identity: RemoteMcpIdentity, input: DocumentProbe) {
    requireScope(identity.scopes, "mcp:render");
    assertRenderAvailable(this.database);
    const probe = documentProbeSchema.parse(input);
    const runtimeDigest = this.environment.runtimeDigest();
    if (runtimeDigest === null)
      throw new AppError(
        "DOCUMENT_PROBE_RUNTIME_UNVERIFIED",
        "The active Runtime is not pinned",
        503,
      );
    const result = this.database.transaction(() =>
      this.database.documentProbes.request(
        identity.userId,
        this.rendererVersion,
        probe,
        nowIso(),
      ),
    );
    return {
      probeId: result.id,
      requestFingerprint: result.fingerprint,
      runtimeDigest,
      input: probe,
      scope: "isolated_synthetic_document" as const,
      state: result.status,
      code: result.result_code,
      expiresAt: result.expires_at,
    };
  }

  private requirementInventory?: DocumentRequirementInventory;

  async checkPackages(
    identity: RemoteMcpIdentity,
    names: readonly string[],
  ): Promise<Array<{ name: string; available: boolean }>> {
    requireScope(identity.scopes, "mcp:read");
    return this.environment.checkPackages(names);
  }

  async searchPackages(
    identity: RemoteMcpIdentity,
    query: string,
    cursor = 0,
  ): Promise<RemoteEnvironmentSearch> {
    requireScope(identity.scopes, "mcp:read");
    return this.environment.searchPackages(query, cursor);
  }

  async checkFonts(
    identity: RemoteMcpIdentity,
    names: readonly string[],
  ): Promise<Array<{ name: string; available: boolean }>> {
    requireScope(identity.scopes, "mcp:read");
    return this.environment.checkFonts(names);
  }

  async searchFonts(
    identity: RemoteMcpIdentity,
    query: string,
    cursor = 0,
  ): Promise<RemoteEnvironmentSearch> {
    requireScope(identity.scopes, "mcp:read");
    return this.environment.searchFonts(query, cursor);
  }

  cancel(identity: RemoteMcpIdentity, jobId: string): RemoteJobSummary {
    requireScope(identity.scopes, "mcp:cancel");
    this.assertOwned(identity.userId, jobId);
    if (this.database.jobs.cancel(jobId, nowIso()) !== 1)
      throw new AppError("JOB_NOT_CANCELABLE", "Job is not cancelable", 409);
    return this.job({ ...identity, scopes: ["mcp"] }, jobId);
  }

  delete(
    identity: RemoteMcpIdentity,
    jobId: string,
  ): { jobId: string; accepted: true } {
    requireScope(identity.scopes, "mcp:delete");
    this.assertOwned(identity.userId, jobId);
    if (this.database.jobs.markDeleting(jobId, nowIso()) !== 1)
      throw new AppError("JOB_NOT_DELETABLE", "Job is not deletable", 409);
    return { jobId, accepted: true };
  }

  enforceRateLimit(userId: string, toolName: string, limit: number): void {
    const minute = new Date();
    minute.setUTCSeconds(0, 0);
    const count = this.database.remoteMcp.incrementRateLimit(
      userId,
      toolName,
      minute.toISOString(),
    );
    if (count > limit)
      throw new AppError(
        "REMOTE_MCP_RATE_LIMIT",
        "Remote MCP tool rate limit exceeded",
        429,
        { retryAfterSeconds: 60 },
      );
  }

  auditToolCall(
    identity: RemoteMcpIdentity,
    toolName: string,
    result: "success" | "failure",
    metadata: Readonly<Record<string, unknown>> = {},
  ): void {
    this.database.audit({
      actorType: "oauth",
      actorId: identity.userId,
      action: `remote_mcp.tool.${toolName}`,
      targetType: "remote_mcp_tool",
      targetId: toolName,
      result,
      metadata,
    });
  }

  private async appendSourceChunk(
    userId: string,
    uploadId: string,
    offset: number,
    base64: string,
  ): Promise<RemoteSourceUpload> {
    const source = this.sources.assertOwnedSource(userId, uploadId);
    if (source.status === "ready")
      this.sources.resolveOwnedSource(userId, uploadId);
    if (source.status !== "ready" && source.expires_at <= nowIso())
      throw new AppError(
        "SOURCE_UPLOAD_EXPIRED",
        "Source upload has expired",
        410,
      );
    if (source.status !== "ready" && source.status !== "uploading")
      throw new AppError(
        "SOURCE_UPLOAD_STATE",
        "Source upload is not active",
        409,
      );
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new AppError(
        "SOURCE_UPLOAD_OFFSET",
        "Chunk offset is invalid",
        400,
      );
    const bytes = decodeSourceBase64(base64);
    if (
      bytes.byteLength < 1 ||
      bytes.byteLength > SOURCE_UPLOAD_CHUNK_MAX_BYTES
    )
      throw new AppError(
        "SOURCE_UPLOAD_CHUNK_SIZE",
        "Chunk must contain between 1 byte and 512 KiB",
        400,
      );
    if (source.status === "ready") {
      if (offset + bytes.byteLength > source.size)
        throw uploadOffsetMismatch(source.size);
      const handle = await open(this.sources.sourcePath(source), "r");
      try {
        const received = Buffer.alloc(bytes.byteLength);
        const { bytesRead } = await handle.read(
          received,
          0,
          received.length,
          offset,
        );
        if (bytesRead !== bytes.length || !received.equals(bytes))
          throw uploadOffsetMismatch(source.size);
      } finally {
        await handle.close();
      }
      return uploadProgress(source, source.size);
    }
    const leaseOwner = `remote-mcp:${process.pid}:${randomUUID()}`,
      timestamp = nowIso(),
      leaseExpiresAt = new Date(
        Date.now() + SOURCE_UPLOAD_LEASE_MS,
      ).toISOString(),
      leased = this.database.sources.claimUploadLease(
        uploadId,
        userId,
        leaseOwner,
        timestamp,
        leaseExpiresAt,
      );
    if (leased === undefined)
      throw new AppError(
        "SOURCE_UPLOAD_CONCURRENT",
        "Another chunk or finalize operation is using this upload",
        409,
      );
    try {
      const path = this.sources.sourcePath(leased),
        current = await stat(path),
        chunks = this.sourceUploadChunkRoot(leased),
        expectedOffset = leased.upload_received_bytes;
      // Pre-v15 partial uploads were written in place and cannot safely be
      // fenced after an upgrade. Fail closed rather than letting a stale
      // writer race a new instance; clients can begin a fresh upload.
      if (current.size !== 0)
        throw new AppError(
          "SOURCE_UPLOAD_STATE",
          "Source upload uses an unsafe legacy staging format; start a new upload",
          409,
        );
      try {
        if (!(await stat(chunks)).isDirectory())
          throw new Error("not a directory");
      } catch {
        throw new AppError(
          "SOURCE_UPLOAD_STATE",
          "Source upload uses an unsafe legacy staging format; start a new upload",
          409,
        );
      }
      if (offset < expectedOffset && offset + bytes.length <= expectedOffset) {
        const prior = await readFile(join(chunks, String(offset))).catch(
          (error: unknown) => {
            if (
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
              return undefined;
            throw error;
          },
        );
        if (prior?.equals(bytes)) return uploadProgress(leased, expectedOffset);
      }
      if (offset !== expectedOffset) throw uploadOffsetMismatch(expectedOffset);
      if (offset + bytes.byteLength > leased.size)
        throw new AppError(
          "SOURCE_UPLOAD_OVERFLOW",
          "Chunk exceeds the declared Source size",
          400,
        );
      await writeUploadChunk(chunks, offset, bytes);
      const nextOffset = offset + bytes.byteLength;
      if (
        this.database.transaction(() => {
          assertSourceWritable(this.database);
          return this.database.sources.commitUploadOffset(
            uploadId,
            leaseOwner,
            expectedOffset,
            nextOffset,
            nowIso(),
          );
        }) !== 1
      )
        throw new AppError(
          "SOURCE_UPLOAD_CONCURRENT",
          "Source upload lease expired or changed while writing",
          409,
        );
      return uploadProgress(leased, nextOffset);
    } finally {
      this.database.sources.releaseUploadLease(uploadId, leaseOwner);
    }
  }

  private async completeSourceUpload(
    userId: string,
    uploadId: string,
  ): Promise<RemoteSourceSummary> {
    const source = this.sources.assertOwnedSource(userId, uploadId);
    if (source.status === "ready")
      return this.summarizeSource(
        this.sources.resolveOwnedSource(userId, uploadId),
        null,
      );
    if (source.expires_at <= nowIso())
      throw new AppError(
        "SOURCE_UPLOAD_EXPIRED",
        "Source upload has expired",
        410,
      );
    if (source.status !== "uploading")
      throw new AppError(
        "SOURCE_UPLOAD_STATE",
        "Source upload is not active",
        409,
      );
    const leaseOwner = `remote-mcp:${process.pid}:${randomUUID()}`,
      leased = this.database.sources.claimUploadLease(
        uploadId,
        userId,
        leaseOwner,
        nowIso(),
        new Date(Date.now() + SOURCE_UPLOAD_LEASE_MS).toISOString(),
      );
    if (leased === undefined)
      throw new AppError(
        "SOURCE_UPLOAD_CONCURRENT",
        "Another chunk or finalize operation is using this upload",
        409,
      );
    const heartbeatState: { error?: AppError } = {};
    const assertHeartbeat = (): void => {
      if (heartbeatState.error !== undefined) throw heartbeatState.error;
    };
    const renewLease = (): void => {
        assertSourceWritable(this.database);
        const timestamp = nowIso();
        if (
          this.database.sources.extendUploadLease(
            uploadId,
            leaseOwner,
            timestamp,
            new Date(Date.now() + SOURCE_UPLOAD_LEASE_MS).toISOString(),
          ) !== 1
        )
          throw new AppError(
            "SOURCE_UPLOAD_CONCURRENT",
            "Source upload lease expired or changed while finalizing",
            409,
          );
      },
      heartbeat = setInterval(
        () => {
          if (heartbeatState.error !== undefined) return;
          try {
            renewLease();
          } catch (error) {
            heartbeatState.error =
              error instanceof AppError
                ? error
                : new AppError(
                    "SOURCE_UPLOAD_CONCURRENT",
                    "Source upload lease could not be renewed",
                    409,
                  );
          }
        },
        Math.floor(SOURCE_UPLOAD_LEASE_MS / 3),
      );
    heartbeat.unref();
    try {
      const path = this.sources.sourcePath(leased),
        current = await stat(path);
      if (!current.isFile() || leased.upload_received_bytes !== leased.size)
        throw new AppError(
          "SOURCE_UPLOAD_MISMATCH",
          "Uploaded Source size does not match the durable upload offset",
          422,
        );
      if (current.size !== 0 && current.size !== leased.size)
        throw new AppError(
          "SOURCE_UPLOAD_MISMATCH",
          "Source upload storage does not match the durable upload offset",
          422,
        );
      const assembled =
        current.size === leased.size
          ? path
          : await assembleUploadChunks(
              this.sourceUploadChunkRoot(leased),
              path,
              leaseOwner,
              leased.size,
            );
      let inspection: string | undefined;
      try {
        const digest = await sha256File(assembled),
          verified = await stat(assembled);
        assertHeartbeat();
        renewLease();
        if (verified.size !== leased.size || digest !== leased.sha256)
          throw new AppError(
            "SOURCE_UPLOAD_MISMATCH",
            "Uploaded Source size or SHA-256 does not match",
            422,
          );
        inspection = await mkdtemp(
          join(this.storageRoot, `.remote-source-${leased.id}-`),
        );
        const result = await validateAndExtract(
            assembled,
            inspection,
            this.sources.zipLimits(),
            "",
          ),
          timestamp = nowIso(),
          expiresAt = this.sources.sourceRetentionExpiresAt();
        assertHeartbeat();
        renewLease();
        if (assembled !== path) {
          await rename(assembled, path);
          await syncDirectory(dirname(path));
        }
        if (
          this.database.transaction(() => {
            assertSourceWritable(this.database);
            return this.database.sources.completeUpload(
              leased.id,
              leaseOwner,
              timestamp,
              expiresAt,
              JSON.stringify([...result.paths].sort()),
            );
          }) !== 1
        )
          throw new AppError(
            "SOURCE_UPLOAD_CONCURRENT",
            "Source upload lease expired or changed while finalizing",
            409,
          );
        clearInterval(heartbeat);
        await rm(this.sourceUploadChunkRoot(leased), {
          recursive: true,
          force: true,
        });
        const ready = this.database.sources.get(leased.id);
        if (ready === undefined)
          throw new AppError("SOURCE_CREATE_FAILED", "Source creation failed");
        return this.summarizeSource(ready, null);
      } finally {
        // The temporary assembled archive is only promoted after all checks.
        await Promise.all([
          ...(assembled !== path ? [rm(assembled, { force: true })] : []),
          ...(inspection !== undefined
            ? [rm(inspection, { recursive: true, force: true })]
            : []),
        ]);
      }
    } finally {
      clearInterval(heartbeat);
      this.database.sources.releaseUploadLease(uploadId, leaseOwner);
    }
  }

  private async reviseSource(
    userId: string,
    sourceId: string,
    mutation: (root: string) => Promise<void>,
    onReady?: (sourceId: string) => void,
  ): Promise<RemoteSourceSummary> {
    assertSourceWritable(this.database);
    const source = this.sources.resolveOwnedSource(userId, sourceId),
      root = await mkdtemp(
        join(this.storageRoot, `.remote-revision-${source.id}-`),
      );
    try {
      await validateAndExtract(
        this.sources.sourcePath(source),
        root,
        this.sources.zipLimits(),
        "",
      );
      await mutation(root);
      const files = (
          await readDirectoryFiles(root, "", {
            files: 0,
            bytes: 0,
            maxFiles: this.resourceLimits.maxFileCount,
            maxBytes: this.resourceLimits.maxExtractedBytes,
            maxFileBytes: this.resourceLimits.maxUploadBytes,
          })
        ).sort((left, right) => left.path.localeCompare(right.path)),
        paths = files.map((file) => file.path),
        archiveRoot = await mkdtemp(join(this.storageRoot, ".remote-archive-")),
        archive = join(archiveRoot, "source.zip");
      try {
        assertTexSource(paths);
        await writeZipFiles(files, archive, this.sources.zipLimits());
        // A mutation can introduce case- or Unicode-colliding paths even
        // though each path passed validation on its own. Validate the exact
        // archive the worker will consume before making the Source ready.
        const verified = await validateAndExtract(
          archive,
          join(archiveRoot, "inspection"),
          this.sources.zipLimits(),
          "",
        );
        const revision = await this.sources.storeReadySourceArchive(
          userId,
          archive,
          verified.paths,
          onReady,
        );
        return this.summarizeSource(revision, source.id);
      } finally {
        await rm(archiveRoot, { recursive: true, force: true });
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  private summarizeSource(
    source: SourceRow,
    revisionOf: string | null,
  ): RemoteSourceSummary {
    return {
      id: source.id,
      status: source.status,
      size: source.size,
      sha256: source.sha256,
      paths: this.database.sources.paths(source),
      createdAt: source.created_at,
      expiresAt: source.expires_at,
      revisionOf,
    };
  }

  private sourceUploadChunkRoot(source: SourceRow): string {
    return join(dirname(this.sources.sourcePath(source)), ".chunks");
  }

  private ensurePrincipal(userId: string): RemoteMcpPrincipalRow {
    const existing = this.database.remoteMcp.principal(userId);
    if (existing !== undefined) return existing;
    const timestamp = nowIso(),
      principal: RemoteMcpPrincipalRow = {
        user_id: userId,
        service_account_id: newId("sa"),
        api_key_id: newId("key"),
        created_at: timestamp,
      };
    try {
      this.database.transaction(() => {
        this.database.serviceAccounts.insert({
          id: principal.service_account_id,
          ownerUserId: userId,
          // Display names are user-editable, not a reserved identity. Keep a
          // same-named account separate and check under this write transaction.
          name: this.database.serviceAccounts.nameExists(userId, "Remote MCP")
            ? `Remote MCP (${principal.service_account_id})`
            : "Remote MCP",
          clientType: "mcp",
          timestamp,
        });
        this.database.apiKeys.insert({
          id: principal.api_key_id,
          serviceAccountId: principal.service_account_id,
          name: "Remote MCP accounting principal",
          prefix: `oauth_${principal.api_key_id.slice(4)}`,
          kind: "render",
          secretHash: "0".repeat(64),
          pepperId: "oauth-principal",
          scopes: ["oauth:mcp"],
          createdAt: timestamp,
          createdBy: "remote_mcp",
        });
        this.database.remoteMcp.insertPrincipal(principal);
      });
      return principal;
    } catch (error) {
      const raced = this.database.remoteMcp.principal(userId);
      if (raced !== undefined) return raced;
      throw error;
    }
  }

  private resolveSourceRef(userId: string, sourceRef: string): SourceRow {
    const reference = this.database.sources.sourceRef(
      sourceRef,
      userId,
      nowIso(),
    );
    if (reference === undefined)
      throw new AppError(
        "SOURCE_REF_INVALID",
        "Source reference is invalid",
        404,
      );
    const source = this.database.sources.getOwnedReady(
      reference.source_id,
      userId,
      nowIso(),
    );
    if (source === undefined)
      throw new AppError(
        "SOURCE_NOT_READY",
        "Referenced Source is not ready",
        409,
      );
    return source;
  }

  private async createInlineSource(
    userId: string,
    content: string,
    entrypoint: string,
  ): Promise<SourceRow> {
    assertSourceWritable(this.database);
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes < 1 || contentBytes > INLINE_SOURCE_MAX_BYTES)
      throw new AppError(
        "INLINE_SOURCE_SIZE",
        "Inline source must be between 1 byte and 64 KiB",
        400,
      );
    const limits = directSourceLimits(this.resourceLimits);
    if (contentBytes > limits.fileBytes)
      throw new AppError(
        "SOURCE_FILE_SIZE",
        "Inline Source exceeds the configured file limit",
        400,
      );
    if (contentBytes > limits.contentBytes)
      throw new AppError(
        "SOURCE_TOTAL_SIZE",
        "Inline Source exceeds the configured content limit",
        400,
      );
    return this.validateAndStoreSource(
      userId,
      await zipFiles(
        [{ path: entrypoint, bytes: Buffer.from(content, "utf8") }],
        this.sources.zipLimits(),
      ),
    );
  }

  private assertReadableJob(userId: string, jobId: string): JobRow {
    const visible = this.database.jobs.getVisible(jobId);
    if (
      visible?.user_id === userId &&
      visible.deleted_at === null &&
      this.database.drafts.isOwnedProjectPreview(jobId, userId)
    )
      return visible;
    return this.assertOwned(userId, jobId);
  }

  private assertOwned(userId: string, jobId: string): JobRow {
    const principal = this.ensurePrincipal(userId),
      row = this.database.jobs.getOwned(
        jobId,
        userId,
        principal.service_account_id,
      );
    if (row === undefined)
      throw new AppError("JOB_NOT_FOUND", "Job does not exist", 404);
    return row;
  }

  private artifactExpiry(job: JobRow) {
    return artifactRetentionExpiresAt(
      this.database.outputStages.retentionStart(
        job.id,
        job.completed_at ?? job.updated_at,
      ),
      this.artifactRetentionHours,
    );
  }

  private summarize(row: JobRow): RemoteJobSummary {
    const stages = this.database.outputStages.publicState(row.id);
    const artifacts = this.database.artifacts.listDownloadable(row.id, {
        retentionHours: this.artifactRetentionHours,
      }),
      generatedPages = artifacts
        .filter((artifact) => artifact.type === "preview")
        .map((artifact) => previewPage(artifact.relative_path))
        .filter((page): page is number => page !== null)
        .sort((left, right) => left - right),
      document = this.database.previews.verifiedPdf(row.id, {
        retentionHours: this.artifactRetentionHours,
      })
        ? this.database.previews.document(row.id)
        : undefined,
      previewPages = document
        ? Array.from({ length: document.page_count }, (_, index) => index + 1)
        : generatedPages;
    return {
      id: row.id,
      status: row.status,
      ...this.database.jobs.renderProvenance(row),
      rendererVersion: row.renderer_version,
      sourceId: row.source_id,
      projectRevisionId: row.project_revision_id,
      entrypoint: row.entrypoint,
      outputs: this.database.jobs.outputs(row),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      queuedAt: row.queued_at,
      startedAt: row.started_at,
      finishedAt: row.completed_at,
      retentionExpiresAt:
        artifacts.length > 0 || row.completed_at !== null
          ? this.artifactExpiry(row)
          : null,
      exitCode: row.exit_code,
      retryOf: row.retry_of_job_id,
      errorCode: row.error_code,
      errorMessage: row.error_message,
      previewAvailable: previewPages.length > 0,
      previewPages,
      artifacts: artifacts.map((artifact) => ({
        type: artifact.type,
        filename: artifact.relative_path.split("/").at(-1) as string,
        mimeType: artifactMimeType(artifact.type),
        relativePath: artifact.relative_path,
        size: artifact.size,
        sha256: artifact.sha256,
        pageCount: artifact.type === "pdf" ? previewPages.length || null : null,
        resourceUri: resourceUri(row.id, artifact.relative_path),
      })),
      webResultUrl: new URL(
        `/app/jobs/${encodeURIComponent(row.id)}/`,
        this.publicOrigin,
      ).toString(),
      ...(stages === undefined ? {} : { stages }),
    };
  }

  private artifactPath(artifact: ArtifactRow): string {
    return artifactStoragePath(this.storageRoot, artifact);
  }

  private acquireInlineArtifactBytes(bytes: number): Promise<() => void> {
    if (
      this.inlineArtifactBytesInFlight + bytes <=
      REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT
    ) {
      this.inlineArtifactBytesInFlight += bytes;
      return Promise.resolve(() => this.releaseInlineArtifactBytes(bytes));
    }
    return new Promise((resolve) => {
      this.inlineArtifactWaiters.push({ bytes, resolve });
    });
  }

  private releaseInlineArtifactBytes(bytes: number): void {
    this.inlineArtifactBytesInFlight = Math.max(
      0,
      this.inlineArtifactBytesInFlight - bytes,
    );
    while (this.inlineArtifactWaiters.length > 0) {
      const index = this.inlineArtifactWaiters.findIndex(
        (waiter) =>
          this.inlineArtifactBytesInFlight + waiter.bytes <=
          REMOTE_MCP_MAX_INLINE_ARTIFACT_BYTES_IN_FLIGHT,
      );
      if (index < 0) return;
      const waiter = this.inlineArtifactWaiters.splice(index, 1)[0];
      if (waiter === undefined) return;
      this.inlineArtifactBytesInFlight += waiter.bytes;
      waiter.resolve(() => this.releaseInlineArtifactBytes(waiter.bytes));
    }
  }
}

function artifactMimeType(type: string): string {
  return (
    {
      pdf: "application/pdf",
      log: "text/plain; charset=utf-8",
      errors: "application/json",
      dependencies: "application/json",
      preview: "image/png",
      svg: "image/svg+xml",
      svg_manifest: "application/json",
    }[type] ?? "application/octet-stream"
  );
}

async function readBoundedArtifact(
  path: string,
  expectedSize: number,
  maximumBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new AppError("ARTIFACT_NOT_FOUND", "Artifact does not exist", 404);
    throw error;
  }
  try {
    signal.throwIfAborted();
    const initial = await handle.stat();
    if (
      !initial.isFile() ||
      !Number.isSafeInteger(initial.size) ||
      initial.size !== expectedSize
    )
      throw new AppError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact metadata does not match the stored file",
        503,
      );
    if (initial.size > maximumBytes)
      throw new AppError(
        "ARTIFACT_TOO_LARGE",
        "Artifact exceeds the MCP inline resource limit",
        413,
      );

    const bytes = Buffer.allocUnsafe(initial.size);
    let offset = 0;
    while (offset < initial.size) {
      signal.throwIfAborted();
      const length = Math.min(ARTIFACT_READ_CHUNK_BYTES, initial.size - offset);
      const result = await handle.read(bytes, offset, length, offset);
      if (result.bytesRead <= 0)
        throw new AppError(
          "ARTIFACT_UNAVAILABLE",
          "Artifact ended before its recorded size",
          503,
        );
      offset += result.bytesRead;
      if (offset > maximumBytes)
        throw new AppError(
          "ARTIFACT_TOO_LARGE",
          "Artifact exceeds the MCP inline resource limit",
          413,
        );
    }
    const final = await handle.stat();
    signal.throwIfAborted();
    if (final.size !== expectedSize)
      throw new AppError(
        "ARTIFACT_UNAVAILABLE",
        "Artifact changed while it was being read",
        503,
      );
    return bytes;
  } finally {
    await handle.close();
  }
}

function normalizeRenderOutputs(
  value: Array<"pdf" | "svg"> | undefined,
): Array<"pdf" | "svg"> {
  const result = renderOutputsSchema.safeParse(value);
  if (!result.success)
    throw new AppError("INVALID_OUTPUTS", "Render outputs are invalid", 400);
  return result.data;
}

function previewPage(relativePath: string): number | null {
  const match = /^previews\/page-(\d+)\.png$/.exec(relativePath);
  return match === null ? null : Number(match[1]);
}

function resourceUri(jobId: string, relativePath: string): string {
  if (relativePath === "result.pdf")
    return `latex-renderer://jobs/${jobId}/output.pdf`;
  if (relativePath === "compile.log")
    return `latex-renderer://jobs/${jobId}/build.log`;
  const page = previewPage(relativePath);
  if (page !== null) return `latex-renderer://jobs/${jobId}/preview/${page}`;
  return `latex-renderer://jobs/${jobId}/artifact/${encodeURIComponent(relativePath)}`;
}

function uploadProgress(
  source: SourceRow,
  receivedBytes: number,
): RemoteSourceUpload {
  return {
    uploadId: source.id,
    sourceId: source.id,
    expectedBytes: source.size,
    receivedBytes,
    expiresAt: source.expires_at,
    maxChunkBytes: SOURCE_UPLOAD_CHUNK_MAX_BYTES,
  };
}

function uploadOffsetMismatch(expectedOffset: number): AppError {
  return new AppError(
    "SOURCE_UPLOAD_OFFSET",
    "Chunk does not match the accepted Source data or offset",
    409,
    { expectedOffset },
  );
}

async function writeUploadChunk(
  root: string,
  offset: number,
  bytes: Buffer,
): Promise<void> {
  const temporary = join(root, `.pending-${randomUUID()}`),
    target = join(root, String(offset));
  try {
    const handle = await open(temporary, "wx", 0o660);
    try {
      let written = 0;
      while (written < bytes.byteLength) {
        const result = await handle.write(
          bytes,
          written,
          bytes.byteLength - written,
          written,
        );
        if (result.bytesWritten <= 0)
          throw new AppError(
            "SOURCE_UPLOAD_IO",
            "Failed to write Source chunk",
            503,
          );
        written += result.bytesWritten;
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      // link(2) is create-only: unlike rename it cannot replace a chunk left
      // by a stale writer whose lease has expired.
      await link(temporary, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        // A writer may have linked the exact same chunk just before losing
        // its lease. Its DB CAS will fail, but an identical client retry can
        // safely adopt those immutable bytes and advance the durable offset.
        const existing = await readFile(target);
        if (existing.byteLength !== bytes.byteLength || !existing.equals(bytes))
          throw new AppError(
            "SOURCE_UPLOAD_CONCURRENT",
            "Source upload chunk was written by another instance",
            409,
          );
      } else {
        throw error;
      }
    }
    await syncDirectory(root);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function assembleUploadChunks(
  root: string,
  sourcePath: string,
  leaseOwner: string,
  expectedBytes: number,
): Promise<string> {
  const archive = `${sourcePath}.finalizing-${leaseOwner}`,
    // Acquire ownership before cleanup can remove the destination. A failed
    // exclusive open must never unlink another writer's archive.
    output = await open(archive, "wx", 0o660);
  let offset = 0;
  try {
    try {
      while (offset < expectedBytes) {
        const path = join(root, String(offset)),
          metadata = await stat(path);
        if (
          !metadata.isFile() ||
          !Number.isSafeInteger(metadata.size) ||
          metadata.size < 1 ||
          metadata.size > SOURCE_UPLOAD_CHUNK_MAX_BYTES ||
          offset + metadata.size > expectedBytes
        )
          throw new AppError(
            "SOURCE_UPLOAD_MISMATCH",
            "Uploaded Source chunks do not match the durable offset",
            422,
          );
        for await (const chunk of createReadStream(path)) {
          await output.writeFile(chunk as Buffer);
        }
        offset += metadata.size;
      }
      await output.sync();
    } finally {
      await output.close();
    }
    return archive;
  } catch (error) {
    await rm(archive, { force: true });
    throw error;
  }
}

function assertTexSource(paths: readonly string[]): void {
  if (!paths.some((path) => path.toLowerCase().endsWith(".tex")))
    throw new AppError(
      "TEX_ENTRYPOINT_MISSING",
      "Source must contain at least one .tex file",
      422,
    );
}
