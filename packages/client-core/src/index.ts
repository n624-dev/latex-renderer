import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { pipeline } from "node:stream/promises";
import type {
  JobResponse,
  SourceRenderResponse,
  SourceTicketResponse,
  RenderOutput,
  RenderEngine,
} from "@latex-renderer/contracts";
import {
  JobStatusSchema,
  structuredErrorsSchema,
  type StructuredErrors,
} from "@latex-renderer/contracts";
import { AppError, DEFAULT_RESOURCE_LIMITS, type ResourceLimits } from "@latex-renderer/shared";
import {
  listValidatedSourceFiles,
  validateEntrypointPath,
  validateSourceFilePath,
} from "@latex-renderer/zip-validation";
import ignore, { type Ignore } from "ignore";
import yazl from "yazl";
import { shouldExcludeProjectPath } from "./project-files.js";
import { resolveLocalTexEngine } from "./tex-engine.js";
import { pollUntilTerminal } from "./polling.js";
import {
  createJobTicketAccess,
  type JobTicketAccess,
} from "./job-ticket-access.js";
import { pruneGeneratedArtifacts } from "./artifact-cleanup.js";
import { publishArtifactSet } from "./artifact-transaction.js";
import {
  ensureSecureDirectory,
  assertSafeOutputFile,
} from "./output-safety.js";
export { ensureSecureDirectory } from "./output-safety.js";

export { shouldExcludeProjectPath } from "./project-files.js";
export { openLocalTarget } from "./open-local-target.js";
export { withClientOperationDeadline } from "./operation-deadline.js";
export {
  renderEngineSchema,
  type RenderEngine,
} from "@latex-renderer/contracts";

export interface ClientTransport {
  sourceLimits?(options?: { signal?: AbortSignal | undefined }): Promise<ResourceLimits | undefined>;
  preparePreview?(
    jobId: string,
    page: number,
    ticket: string,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<void>;
  retrySvgJob?(
    jobId: string,
    idempotencyKey: string,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<SourceRenderResponse>;
  createSource(
    size: number,
    sha256: string,
    idempotencyKey: string,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<SourceTicketResponse>;
  uploadSource(
    ticket: SourceTicketResponse,
    zipPath: string,
    size: number,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<void>;
  createSourceJob(
    sourceId: string,
    entrypoint: string | undefined,
    idempotencyKey: string,
    outputs?: readonly RenderOutput[],
    engine?: RenderEngine,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<SourceRenderResponse>;
  job(
    jobId: string,
    jobTicket: string,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<JobResponse>;
  renewJobTicket(
    jobId: string,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<{ jobTicket: string; expiresAt: string }>;
  action(
    jobId: string,
    jobTicket: string,
    action: "cancel" | "delete",
  ): Promise<void>;
  artifactUrl(jobId: string, name: string): string;
  previewUrl(jobId: string, page: string): string;
  download(
    url: string,
    ticket: string,
    destination: string,
    expected: { size: number; sha256: string },
    options?: { signal?: AbortSignal | undefined },
  ): Promise<void>;
}

export type ClientCoreEvent =
  | { type: "archive.created"; size: number; sha256: string; files: number }
  | { type: "source.ready"; sourceId: string; uploadRequired: boolean }
  | { type: "job.queued"; jobId: string }
  | {
      type: "job.status";
      jobId: string;
      status: JobResponse["status"];
      resourceWait?: string;
    }
  | { type: "artifact.downloaded"; name: string; path: string };

export interface ArtifactPaths {
  pdf?: string;
  errors?: string;
  log?: string;
  job: string;
  previews: string[];
  svg: string[];
  svgDiagnostics?: string[];
}

export interface RenderProjectResult {
  job: JobResponse;
  outputDirectory: string;
  source: UploadedSource;
  artifacts: ArtifactPaths;
}

export interface DownloadArtifactsResult {
  job: JobResponse;
  outputDirectory: string;
  artifacts: ArtifactPaths;
}

export interface ClientCoreOptions {
  signal?: AbortSignal | undefined;
  onEvent?: (event: ClientCoreEvent) => void;
  outputs?: readonly RenderOutput[];
  engine?: RenderEngine | undefined;
  pdfOnly?: boolean;
  /** Explicitly generate these pages; default downloads only existing PNGs. */
  previewPages?: readonly number[];
}

export interface UploadedSource {
  sourceId: string;
  uploadRequired: boolean;
  size: number;
  sha256: string;
  files: number;
}

export interface RenderOptions extends ClientCoreOptions {
  entrypoint?: string;
  outputDirectory?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

export async function renderProject(
  client: ClientTransport,
  projectPath: string,
  options: RenderOptions = {},
): Promise<RenderProjectResult> {
  const input = resolve(projectPath),
    entrypoint = validateEntrypointPath(options.entrypoint ?? "main.tex"),
    requestedOutput =
      options.outputDirectory === undefined
        ? undefined
        : resolve(options.outputDirectory);
  const temporary = await mkdtemp(join(tmpdir(), "latex-render-"));
  try {
    const zipPath = join(temporary, "source.zip");
    const limits = await client.sourceLimits?.({ signal: options.signal });
    const prepared = await prepareInputArchive(
      input,
      zipPath,
      entrypoint,
      requestedOutput,
      options.signal,
      limits,
    );
    options.onEvent?.({ type: "archive.created", ...prepared.source });
    const source = await reserveAndUploadSource(
      client,
      zipPath,
      prepared.source,
      options,
    );
    const ticket = await startSourceJob(
      client,
      source.sourceId,
      entrypoint,
      options.outputs,
      options.engine,
      options.signal,
    );
    const outputDirectory =
      requestedOutput ?? resolve(join(prepared.outputRoot, ".render"));
    const completed = await completeAcceptedRender(
      client,
      ticket,
      outputDirectory,
      options,
    );
    return { ...completed, source };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

/** Compile a project entrypoint and publish only the verified PDF. */
export async function compileProjectPdf(
  client: ClientTransport,
  input: string,
  options: Pick<
    RenderOptions,
    "pollIntervalMs" | "pollTimeoutMs" | "onEvent" | "engine" | "signal"
  > & {
    projectRoot?: string;
    output?: string;
  } = {},
): Promise<{
  job: JobResponse;
  pdf?: string;
  diagnostics?: StructuredErrors;
}> {
  const root = resolve(options.projectRoot ?? process.cwd());
  const entrypoint = validateEntrypointPath(
    relative(root, resolve(root, input)).split(sep).join("/"),
  );
  const destination = resolve(
    root,
    options.output ?? `${basename(entrypoint, extname(entrypoint))}.pdf`,
  );
  if (extname(destination).toLowerCase() !== ".pdf")
    throw new AppError(
      "INVALID_PDF_DESTINATION",
      "Output must be a .pdf file",
      400,
    );
  await assertSafeOutputFile(destination);
  const work = await mkdtemp(join(tmpdir(), "n624-latex-"));
  let jobId: string | undefined;
  try {
    const zip = join(work, "source.zip");
    const limits = await client.sourceLimits?.({ signal: options.signal });
    const archive = await createProjectArchive(
      root,
      zip,
      entrypoint,
      destination,
      options.signal,
      limits,
    );
    options.onEvent?.({ type: "archive.created", ...archive });
    const engine =
      options.engine ?? (await resolveLocalTexEngine(root, zip, entrypoint));
    const source = await reserveAndUploadSource(client, zip, archive, options);
    const ticket = await startSourceJob(
      client,
      source.sourceId,
      entrypoint,
      undefined,
      engine,
      options.signal,
    );
    jobId = ticket.jobId;
    options.onEvent?.({ type: "job.queued", jobId: ticket.jobId });
    const settled = await pollUntilTerminal(client, ticket, options);
    const { job } = settled;
    const access = artifactTicketAccess(client, settled, options);
    if (job.status !== "succeeded") {
      const artifact = job.artifacts.find(
        ({ relativePath }) => relativePath === "errors.json",
      );
      if (artifact !== undefined && artifact.size <= 1024 ** 2) {
        try {
          const path = join(work, "errors.json");
          await downloadVerified(
            client,
            client.artifactUrl(job.id, "errors.json"),
            access,
            path,
            artifact,
          );
          const diagnostics = structuredErrorsSchema.safeParse(
            JSON.parse(await readFile(path, "utf8")),
          );
          if (diagnostics.success)
            return { job, diagnostics: diagnostics.data };
        } catch {
          options.signal?.throwIfAborted();
          // The Job failure remains authoritative if optional diagnostics are unavailable.
        }
      }
      return { job };
    }

    const pdf = job.artifacts.find(
      ({ relativePath }) => relativePath === "result.pdf",
    );
    if (pdf === undefined || pdf.size <= 0 || pdf.size > 1024 ** 3)
      throw new AppError(
        "INVALID_ARTIFACT_METADATA",
        "The renderer returned no valid PDF",
        502,
      );
    const directory = dirname(destination);
    await ensureSecureDirectory(directory);
    const parent = await realpath(directory);
    const { dev, ino } = await lstat(parent, { bigint: true });
    const stage = await mkdtemp(join(parent, ".n624-latex-pdf-"));
    try {
      const staged = join(stage, "result.pdf");
      await downloadVerified(
        client,
        client.artifactUrl(job.id, "result.pdf"),
        access,
        staged,
        pdf,
      );
      const file = await open(
        staged,
        process.platform === "win32" ? "r+" : "r",
      );
      try {
        await file.sync();
      } finally {
        await file.close();
      }
      const rechecked = await lstat(directory, { bigint: true });
      if (
        rechecked.dev !== dev ||
        rechecked.ino !== ino ||
        (await realpath(directory)) !== parent
      )
        throw new AppError(
          "UNSAFE_OUTPUT_DIRECTORY",
          "PDF output directory changed while downloading",
          409,
        );
      await assertSafeOutputFile(destination);
      options.signal?.throwIfAborted();
      await rename(staged, destination);
      options.onEvent?.({
        type: "artifact.downloaded",
        name: "result.pdf",
        path: destination,
      });
      return { job, pdf: destination };
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => undefined);
    }
  } catch (error) {
    if (jobId === undefined) throw error;
    const reason: unknown = options.signal?.reason;
    const cause = reason instanceof AppError ? reason : error;
    throw new AppError(
      cause instanceof AppError ? cause.code : "PDF_PUBLICATION_FAILED",
      `${cause instanceof Error ? cause.message : "PDF could not be saved"} (job ${jobId})`,
      cause instanceof AppError ? cause.status : 500,
      { jobId },
    );
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function uploadProjectSource(
  client: Pick<
    ClientTransport,
    "sourceLimits" | "createSource" | "uploadSource"
  >,
  projectPath: string,
  options: ClientCoreOptions & { idempotencyKey?: string } = {},
): Promise<UploadedSource> {
  const temporary = await mkdtemp(join(tmpdir(), "latex-source-"));
  try {
    const zipPath = join(temporary, "source.zip"),
      limits = await client.sourceLimits?.({ signal: options.signal }),
      prepared = await prepareInputArchive(
        resolve(projectPath),
        zipPath,
        undefined,
        undefined,
        options.signal,
        limits,
      );
    options.onEvent?.({ type: "archive.created", ...prepared.source });
    return await reserveAndUploadSource(
      client,
      zipPath,
      prepared.source,
      options,
      options.idempotencyKey,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function createSourceRenderJob(
  client: ClientTransport,
  sourceId: string,
  entrypoint = "main.tex",
  options: ClientCoreOptions = {},
): Promise<JobResponse> {
  const ticket = await startSourceJob(
    client,
    sourceId,
    validateEntrypointPath(entrypoint),
    options.outputs,
    options.engine,
    options.signal,
  );
  options.onEvent?.({ type: "job.queued", jobId: ticket.jobId });
  return readAcceptedJob(client, ticket, options.signal);
}

export async function readAcceptedJob(
  client: Pick<ClientTransport, "job">,
  ticket: SourceRenderResponse,
  signal?: AbortSignal,
): Promise<JobResponse> {
  try {
    signal?.throwIfAborted();
    return await client.job(ticket.jobId, ticket.jobTicket, { signal });
  } catch (cause) {
    throw new AppError(
      cause instanceof AppError ? cause.code : "RENDER_STATUS_UNAVAILABLE",
      `Job ${ticket.jobId} was accepted. Check its status before submitting again.`,
      cause instanceof AppError ? cause.status : 503,
      { jobId: ticket.jobId, lastStatus: null },
    );
  }
}

export function acceptedJobRecovery(error: unknown) {
  const details = error instanceof AppError ? error.details : undefined;
  const jobId = details?.jobId;
  if (typeof jobId !== "string" || !/^job_[a-f0-9]{32}$/.test(jobId))
    return undefined;
  const status = JobStatusSchema.safeParse(details?.lastStatus);
  return { jobId, lastStatus: status.success ? status.data : null };
}

export async function renderSource(
  client: ClientTransport,
  sourceId: string,
  options: RenderOptions = {},
): Promise<RenderProjectResult> {
  const entrypoint = validateEntrypointPath(options.entrypoint ?? "main.tex"),
    ticket = await startSourceJob(
      client,
      sourceId,
      entrypoint,
      options.outputs,
      options.engine,
      options.signal,
    );
  const completed = await completeAcceptedRender(
    client,
    ticket,
    resolve(options.outputDirectory ?? ".render"),
    options,
  );
  return {
    ...completed,
    source: {
      sourceId,
      uploadRequired: false,
      size: completed.job.sourceSize,
      sha256: completed.job.sourceSha256,
      files: 0,
    },
  };
}

async function completeAcceptedRender(
  client: ClientTransport,
  ticket: SourceRenderResponse,
  outputDirectory: string,
  options: RenderOptions,
): Promise<DownloadArtifactsResult> {
  let lastStatus: JobResponse["status"] | null = null;
  try {
    options.onEvent?.({ type: "job.queued", jobId: ticket.jobId });
    const settled = await pollUntilTerminal(client, ticket, {
      ...options,
      onEvent: (event) => {
        if (event.type === "job.status") lastStatus = event.status;
        options.onEvent?.(event);
      },
    });
    const job = settled.job;
    const artifacts = await downloadArtifacts(
      client,
      job,
      artifactTicketAccess(client, settled, options),
      outputDirectory,
      options,
    );
    return { job, outputDirectory, artifacts };
  } catch (error) {
    const reason: unknown = options.signal?.reason;
    const cause = reason instanceof AppError ? reason : error;
    throw new AppError(
      cause instanceof AppError ? cause.code : "RENDER_INTERRUPTED",
      cause instanceof AppError
        ? cause.message
        : "Local rendering workflow was interrupted after the server accepted the Job",
      cause instanceof AppError ? cause.status : 500,
      { jobId: ticket.jobId, lastStatus },
    );
  }
}

export async function getJob(
  client: ClientTransport,
  jobId: string,
  signal?: AbortSignal,
): Promise<JobResponse> {
  signal?.throwIfAborted();
  const renewed = await client.renewJobTicket(jobId, { signal });
  return client.job(jobId, renewed.jobTicket, { signal });
}

export async function requestJobAction(
  client: ClientTransport,
  jobId: string,
  action: "cancel" | "delete",
): Promise<{ jobId: string; action: "cancel" | "delete"; requested: true }> {
  const renewed = await client.renewJobTicket(jobId);
  await client.action(jobId, renewed.jobTicket, action);
  return { jobId, action, requested: true };
}

export async function downloadJobArtifacts(
  client: ClientTransport,
  jobId: string,
  outputDirectory: string,
  options: RenderOptions = {},
): Promise<DownloadArtifactsResult> {
  options.signal?.throwIfAborted();
  const renewed = await client.renewJobTicket(jobId, {
    signal: options.signal,
  });
  const settled = await pollUntilTerminal(
    client,
    {
      jobId,
      jobTicket: renewed.jobTicket,
      expiresAt: renewed.expiresAt,
    },
    options,
    options.pdfOnly === true
      ? (job) => job.stages?.pdf.status === "succeeded"
      : undefined,
  );
  let job = settled.job;
  const access = artifactTicketAccess(client, settled, options);
  if (options.previewPages !== undefined) {
    if (
      options.previewPages.length > 100 ||
      options.previewPages.some(
        (page) =>
          !Number.isSafeInteger(page) ||
          page < 1 ||
          page > (job.previewPageCount ?? 100),
      )
    )
      throw new AppError(
        "PREVIEW_PAGE_INVALID",
        "Requested preview page is outside the PDF",
        400,
      );
    for (const page of new Set(options.previewPages)) {
      if (
        job.previews.some(
          (a) =>
            Number(/^previews\/page-(\d+)\.png$/.exec(a.relativePath)?.[1]) ===
            page,
        )
      )
        continue;
      if (!client.preparePreview)
        throw new AppError(
          "PREVIEW_UNSUPPORTED",
          "This transport cannot request ungenerated pages",
          501,
        );
      const preparePreview = client.preparePreview.bind(client);
      await access.read((value) =>
        preparePreview(jobId, page, value, { signal: options.signal }),
      );
    }
    // Sizes/digests always come from the published artifact transaction.
    job = await access.read((value) =>
      client.job(jobId, value, { signal: options.signal }),
    );
    for (const page of new Set(options.previewPages))
      if (
        !job.previews.some(
          (a) =>
            Number(/^previews\/page-(\d+)\.png$/.exec(a.relativePath)?.[1]) ===
            page,
        )
      )
        throw new AppError(
          "PREVIEW_PENDING",
          "Preview metadata is not available",
          503,
        );
  }
  const output = resolve(outputDirectory);
  const artifacts = await downloadArtifacts(
    client,
    job,
    access,
    output,
    options,
  );
  return { job, outputDirectory: output, artifacts };
}

export async function retrySvgJob(
  client: ClientTransport,
  jobId: string,
  outputDirectory: string,
  options: RenderOptions = {},
): Promise<DownloadArtifactsResult> {
  if (!client.retrySvgJob)
    throw new AppError(
      "SVG_RETRY_UNSUPPORTED",
      "This transport does not support SVG-only retries",
      501,
    );
  options.signal?.throwIfAborted();
  const ticket = await client.retrySvgJob(jobId, randomUUID(), {
    signal: options.signal,
  });
  return completeAcceptedRender(client, ticket, resolve(outputDirectory), options);
}

async function prepareInputArchive(
  input: string,
  destination: string,
  entrypoint?: string,
  excludedOutputDirectory?: string,
  signal?: AbortSignal,
  limits?: ResourceLimits,
): Promise<{
  source: { size: number; sha256: string; files: number };
  outputRoot: string;
}> {
  signal?.throwIfAborted();
  const info = await stat(input).catch(() => undefined);
  if (info?.isDirectory())
    return {
      source: await createProjectArchive(
        input,
        destination,
        entrypoint,
        excludedOutputDirectory,
        signal,
        limits,
      ),
      outputRoot: input,
    };
  if (info?.isFile() && extname(input).toLowerCase() === ".zip") {
    if (entrypoint !== undefined) validateEntrypointPath(entrypoint);
    assertArchiveSize(info.size, limits);
    await pipeline(
      createReadStream(input),
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
      signal ? { signal } : {},
    );
    const archive = await stat(destination);
    if (archive.size <= 0)
      throw new AppError("EMPTY_ARCHIVE", "Source ZIP is empty", 400);
    assertArchiveSize(archive.size, limits);
    if (limits) {
      const files = await listValidatedSourceFiles(destination, {
        maxExtractedBytes: limits.maxExtractedBytes,
        maxFileBytes: limits.maxUploadBytes,
        maxEntries: limits.maxZipEntries,
        maxFiles: limits.maxFileCount,
        maxDepth: 10,
        maxNameLength: 200,
      });
      assertExtractedSize(files.reduce((total, file) => total + file.size, 0), limits);
    }
    return {
      source: {
        size: archive.size,
        sha256: await hashFile(destination, signal),
        files: 0,
      },
      outputRoot: dirname(input),
    };
  }
  throw new AppError(
    "INVALID_SOURCE_PATH",
    "Source must be a project directory or .zip file",
    400,
  );
}

function assertArchiveSize(bytes: number, limits: Readonly<ResourceLimits> | undefined): void {
  if (limits && bytes > limits.maxUploadBytes)
    throw new AppError("ARCHIVE_TOO_LARGE", `Source ZIP exceeds ${limits.maxUploadBytes} bytes`, 400);
}

function assertExtractedSize(bytes: number, limits: Readonly<ResourceLimits>): void {
  if (bytes > limits.maxExtractedBytes)
    throw new AppError("PROJECT_TOO_LARGE", `Project files exceed ${limits.maxExtractedBytes} bytes`, 400);
}

async function reserveAndUploadSource(
  client: Pick<ClientTransport, "createSource" | "uploadSource">,
  zipPath: string,
  source: { size: number; sha256: string; files: number },
  options: ClientCoreOptions,
  idempotencyKey: string = randomUUID(),
): Promise<UploadedSource> {
  options.signal?.throwIfAborted();
  const ticket = await client.createSource(
    source.size,
    source.sha256,
    idempotencyKey,
    { signal: options.signal },
  );
  if (ticket.uploadRequired)
    await client.uploadSource(ticket, zipPath, source.size, {
      signal: options.signal,
    });
  options.onEvent?.({
    type: "source.ready",
    sourceId: ticket.sourceId,
    uploadRequired: ticket.uploadRequired,
  });
  return {
    sourceId: ticket.sourceId,
    uploadRequired: ticket.uploadRequired,
    ...source,
  };
}

function startSourceJob(
  client: ClientTransport,
  sourceId: string,
  entrypoint: string,
  outputs: readonly RenderOutput[] = ["pdf"],
  engine?: RenderEngine,
  signal?: AbortSignal,
): Promise<SourceRenderResponse> {
  signal?.throwIfAborted();
  return client.createSourceJob(
    sourceId,
    entrypoint,
    randomUUID(),
    outputs,
    engine,
    { signal },
  );
}

export async function createProjectArchive(
  root: string,
  destination: string,
  entrypoint?: string,
  excludedOutputPath?: string,
  signal?: AbortSignal,
  limits?: ResourceLimits,
): Promise<{ size: number; sha256: string; files: number }> {
  signal?.throwIfAborted();
  const requiredEntrypoint =
    entrypoint === undefined ? undefined : validateEntrypointPath(entrypoint);
  const excludedRelative =
    excludedOutputPath === undefined
      ? undefined
      : relative(resolve(root), resolve(excludedOutputPath));
  if (excludedRelative === "")
    throw new AppError(
      "INVALID_OUTPUT_DIRECTORY",
      "Artifact output directory cannot be the project root",
      400,
    );
  const excludedName =
    excludedRelative === undefined ||
    excludedRelative === ".." ||
    excludedRelative.startsWith(`..${sep}`) ||
    isAbsolute(excludedRelative)
      ? undefined
      : excludedRelative.replaceAll("\\", "/");
  const zip = new yazl.ZipFile();
  // Await exclusive creation before entering cleanup: an EEXIST failure must
  // never cause us to remove a destination belonging to the caller.
  const handle = await open(destination, "wx", 0o600);
  const output = handle.createWriteStream();
  zip.on("error", (error: Error) => output.destroy(error));
  const completion = pipeline(
    zip.outputStream,
    output,
    signal ? { signal } : {},
  );
  // Observe early stream failures while the project directory is being walked.
  void completion.catch(() => undefined);
  let files = 0;
  const maxFiles = limits
    ? Math.min(limits.maxFileCount, limits.maxZipEntries)
    : DEFAULT_RESOURCE_LIMITS.maxFileCount;
  let entrypointFound = false,
    texFound = false;
  let sourceBytes = 0;
  let ended = false;
  try {
    const exclusions = await projectIgnore(root);
    for await (const { path, name, size } of walkProject(
      root,
      exclusions,
      excludedName,
    )) {
      signal?.throwIfAborted();
      try {
        validateSourceFilePath(name);
      } catch (error) {
        if (
          error instanceof AppError &&
          error.code === "ZIP_EXTENSION_REJECTED"
        )
          throw new AppError(
            error.code,
            `Unsupported project file: ${name}`,
            error.status,
          );
        throw error;
      }
      if (name === requiredEntrypoint) entrypointFound = true;
      if (extname(name).toLowerCase() === ".tex") texFound = true;
      files += 1;
      if (files > maxFiles)
        throw new AppError(
          "TOO_MANY_FILES",
          `Project has more than ${maxFiles} files`,
          400,
        );
      if (limits && size > limits.maxUploadBytes)
        throw new AppError("PROJECT_FILE_TOO_LARGE", `Project file exceeds ${limits.maxUploadBytes} bytes: ${name}`, 400);
      sourceBytes += size;
      assertExtractedSize(sourceBytes, limits ?? DEFAULT_RESOURCE_LIMITS);
      zip.addFile(path, name, { mode: 0o600, mtime: new Date(0) });
    }
    if (!texFound)
      throw new AppError(
        "TEX_SOURCE_MISSING",
        "Project must contain at least one .tex file",
        400,
      );
    if (requiredEntrypoint !== undefined && !entrypointFound)
      throw new AppError(
        "ENTRYPOINT_MISSING",
        `Project does not contain ${requiredEntrypoint}`,
        400,
      );
    ended = true;
    zip.end();
    await completion;
    const info = await stat(destination);
    assertArchiveSize(info.size, limits);
    return {
      size: info.size,
      sha256: await hashFile(destination, signal),
      files,
    };
  } catch (error) {
    if (!ended) zip.end();
    output.destroy();
    await completion.catch(() => undefined);
    await rm(destination, { force: true });
    throw error;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

export async function hashFile(
  path: string,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(
    path,
    signal ? { signal } : undefined,
  ))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function artifactTicketAccess(
  client: ClientTransport,
  settled: { job: JobResponse; jobTicket: string; ticketExpiresAt: string },
  options: RenderOptions,
): JobTicketAccess {
  return createJobTicketAccess(
    client,
    {
      jobId: settled.job.id,
      jobTicket: settled.jobTicket,
      expiresAt: settled.ticketExpiresAt,
    },
    options,
  );
}

async function downloadArtifacts(
  client: ClientTransport,
  job: JobResponse,
  access: JobTicketAccess,
  outputDirectory: string,
  options: ClientCoreOptions,
): Promise<ArtifactPaths> {
  const advertised = [...job.artifacts, ...job.previews];
  if (
    advertised.length > 10_000 ||
    advertised.some(
      (item) =>
        !Number.isSafeInteger(item.size) ||
        item.size < 0 ||
        !/^[a-f0-9]{64}$/.test(item.sha256),
    ) ||
    advertised.reduce((total, item) => total + item.size, 0) > 1024 ** 3
  )
    throw new AppError(
      "INVALID_ARTIFACT_METADATA",
      "Artifact metadata is invalid or exceeds the 1 GiB/10000 entry transaction limit",
      502,
    );
  const events: ClientCoreEvent[] = [];
  const result = await publishArtifactSet(outputDirectory, async (stage) => {
    const paths = await stageArtifacts(client, job, access, stage, {
      ...options,
      onEvent: (event) =>
        events.push(
          event.type === "artifact.downloaded"
            ? {
                ...event,
                path: join(outputDirectory, relative(stage, event.path)),
              }
            : event,
        ),
    });
    options.signal?.throwIfAborted();
    const finalPath = (path: string) =>
      join(outputDirectory, relative(stage, path));
    return {
      ...(paths.pdf === undefined ? {} : { pdf: finalPath(paths.pdf) }),
      ...(paths.errors === undefined
        ? {}
        : { errors: finalPath(paths.errors) }),
      ...(paths.log === undefined ? {} : { log: finalPath(paths.log) }),
      job: finalPath(paths.job),
      previews: paths.previews.map(finalPath),
      svg: paths.svg.map(finalPath),
      ...(paths.svgDiagnostics === undefined
        ? {}
        : { svgDiagnostics: paths.svgDiagnostics.map(finalPath) }),
    };
  });
  // No observer sees a successfully downloaded file before the whole set commits.
  for (const event of events) options.onEvent?.(event);
  return result;
}

async function stageArtifacts(
  client: ClientTransport,
  job: JobResponse,
  access: JobTicketAccess,
  outputDirectory: string,
  options: ClientCoreOptions,
): Promise<ArtifactPaths> {
  await ensureSecureDirectory(outputDirectory);
  const paths = new Map(
    job.artifacts.map((artifact) => [artifact.relativePath, artifact]),
  );
  if (paths.size !== job.artifacts.length)
    throw new AppError(
      "INVALID_ARTIFACT_PATH",
      "Server returned duplicate artifact paths",
      502,
    );
  const pdf = await downloadNamedArtifact(
    client,
    job.id,
    access,
    outputDirectory,
    paths.get("result.pdf"),
    options,
  );
  const errors = await downloadNamedArtifact(
    client,
    job.id,
    access,
    outputDirectory,
    paths.get("errors.json"),
    options,
  );
  const log = await downloadNamedArtifact(
    client,
    job.id,
    access,
    outputDirectory,
    paths.get("compile.log"),
    options,
  );
  const previews = await downloadPreviews(
    client,
    job,
    access,
    outputDirectory,
    options,
  );
  const svg: string[] = [];
  for (const artifact of (options.pdfOnly === true ? [] : job.artifacts).filter(
    (item) => item.type === "svg" || item.type === "svg_manifest",
  )) {
    if (
      (artifact.type === "svg_manifest" &&
        artifact.relativePath !== "svg/manifest.json") ||
      (artifact.type === "svg" &&
        !/^svg\/objects\/(?:math|tikz)-[0-9]{6}\.svg$/.test(
          artifact.relativePath,
        ))
    )
      throw new AppError(
        "INVALID_ARTIFACT_PATH",
        "Server returned an unsafe SVG artifact path",
        502,
      );
    const destination = join(outputDirectory, artifact.relativePath);
    await ensureSecureDirectory(dirname(destination));
    await assertSafeOutputFile(destination);
    await downloadVerified(
      client,
      client.artifactUrl(job.id, artifact.relativePath),
      access,
      destination,
      artifact,
    );
    svg.push(destination);
    options.onEvent?.({
      type: "artifact.downloaded",
      name: artifact.relativePath,
      path: destination,
    });
  }
  const svgDiagnostics: string[] = [];
  if (options.pdfOnly !== true)
    for (const name of [
      "svg/compile.log",
      "svg/errors.json",
      "svg/dependencies.json",
    ]) {
      const artifact = paths.get(name);
      if (!artifact) continue;
      await ensureSecureDirectory(join(outputDirectory, "svg"));
      const path = await downloadNamedArtifact(
        client,
        job.id,
        access,
        outputDirectory,
        artifact,
        options,
      );
      if (path !== undefined) svgDiagnostics.push(path);
    }
  // Commit the new job metadata only once its advertised artifacts have been
  // downloaded and leftovers from the previous render have been removed.
  const keep = new Set(
    [pdf, errors, log, ...previews, ...svg, ...svgDiagnostics]
      .filter((path): path is string => path !== undefined)
      .map((path) => relative(outputDirectory, path).replaceAll("\\", "/")),
  );
  await pruneGeneratedArtifacts(outputDirectory, keep);
  const jobPath = join(outputDirectory, "job.json");
  await atomicWriteFile(jobPath, `${JSON.stringify(job, null, 2)}\n`);
  options.onEvent?.({
    type: "artifact.downloaded",
    name: "job.json",
    path: jobPath,
  });
  return {
    ...(pdf === undefined ? {} : { pdf }),
    ...(errors === undefined ? {} : { errors }),
    ...(log === undefined ? {} : { log }),
    job: jobPath,
    previews,
    svg,
    ...(svgDiagnostics.length === 0 ? {} : { svgDiagnostics }),
  };
}

async function downloadPreviews(
  client: ClientTransport,
  job: JobResponse,
  access: JobTicketAccess,
  output: string,
  options: ClientCoreOptions,
): Promise<string[]> {
  if (job.previews.length === 0) return [];
  if (job.previews.length > 100)
    throw new AppError(
      "TOO_MANY_PREVIEWS",
      "Server returned more than 100 previews",
      502,
    );
  const directory = join(output, "previews");
  await ensureSecureDirectory(directory);
  const previews: string[] = [];
  const names = new Set<string>();
  for (const artifact of job.previews) {
    const match = /^previews\/(page-(0*[1-9][0-9]*)\.png)$/.exec(
      artifact.relativePath,
    );
    const name = match?.[1],
      page = Number(match?.[2]),
      canonicalName = `page-${page}.png`;
    if (
      artifact.type !== "preview" ||
      name === undefined ||
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 100 ||
      names.has(canonicalName)
    )
      throw new AppError(
        "INVALID_ARTIFACT_PATH",
        "Server returned an unsafe preview path",
        502,
      );
    names.add(canonicalName);
    const destination = join(directory, canonicalName);
    await assertSafeOutputFile(destination);
    await downloadVerified(
      client,
      client.previewUrl(job.id, name),
      access,
      destination,
      artifact,
    );
    previews.push(destination);
    options.onEvent?.({
      type: "artifact.downloaded",
      name: `previews/${canonicalName}`,
      path: destination,
    });
  }
  return previews;
}

async function downloadNamedArtifact(
  client: ClientTransport,
  jobId: string,
  access: JobTicketAccess,
  output: string,
  artifact: JobResponse["artifacts"][number] | undefined,
  options: ClientCoreOptions,
): Promise<string | undefined> {
  if (artifact === undefined) return undefined;
  const name = artifact.relativePath;
  const destination = join(output, name);
  await assertSafeOutputFile(destination);
  await downloadVerified(
    client,
    client.artifactUrl(jobId, name),
    access,
    destination,
    artifact,
  );
  options.onEvent?.({ type: "artifact.downloaded", name, path: destination });
  return destination;
}

async function downloadVerified(
  client: ClientTransport,
  url: string,
  access: JobTicketAccess,
  destination: string,
  expected: { size: number; sha256: string },
): Promise<void> {
  if (
    !Number.isSafeInteger(expected.size) ||
    expected.size < 0 ||
    !/^[a-f0-9]{64}$/.test(expected.sha256)
  )
    throw new AppError(
      "INVALID_ARTIFACT_METADATA",
      "Artifact size or SHA256 is invalid",
      502,
    );
  await access.read((ticket) =>
    client.download(url, ticket, destination, expected, {
      signal: access.signal,
    }),
  );
  // Also verify custom transports: the core's publication invariant does not
  // depend on a particular HTTP adapter behaving correctly.
  await assertSafeOutputFile(destination);
  if (
    (await lstat(destination)).size !== expected.size ||
    (await hashFile(destination, access.signal)) !== expected.sha256
  )
    throw new AppError(
      "ARTIFACT_INTEGRITY_ERROR",
      "Downloaded artifact does not match its advertised size and SHA256",
      502,
    );
}

async function projectIgnore(root: string): Promise<Ignore> {
  const ignorePath = join(root, ".latexrenderignore");
  const info = await lstat(ignorePath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  });
  if (info !== undefined && (!info.isFile() || info.isSymbolicLink()))
    throw new AppError(
      "INVALID_IGNORE_FILE",
      ".latexrenderignore must be a regular file, not a symbolic link",
      400,
    );
  if (info !== undefined && info.size > 1024 * 1024)
    throw new AppError(
      "INVALID_IGNORE_FILE",
      ".latexrenderignore must not exceed 1 MiB",
      400,
    );
  const custom = info === undefined ? "" : await readFile(ignorePath, "utf8");
  const matcher = ignore();
  if (custom !== "") matcher.add(custom);
  matcher.add([
    ".git/",
    ".render/",
    "node_modules/",
    "**/.env",
    "**/.env.*",
    "**/credentials.json",
    "**/credentials.*",
    "**/*.pem",
    "**/*.key",
    "**/*.p12",
    "**/*.pfx",
    "**/.npmrc",
    "**/.netrc",
    "**/.aws/",
    "**/.ssh/",
    "**/.idea/",
    "**/.vscode/",
    ".latexrenderignore",
  ]);
  return matcher;
}

async function* walkProject(
  root: string,
  exclusions: Ignore,
  excludedName?: string,
  directory = root,
): AsyncGenerator<{ path: string; name: string; size: number }> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const name = relative(root, path).replaceAll("\\", "/");
    if (
      excludedName !== undefined &&
      (process.platform === "win32"
        ? name.toLowerCase() === excludedName.toLowerCase()
        : name === excludedName)
    )
      continue;
    const ignored =
      shouldExcludeProjectPath(name) ||
      exclusions.ignores(entry.isDirectory() ? `${name}/` : name);
    if (ignored) continue;
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new AppError(
        "SYMLINK_REJECTED",
        `Symlink is not allowed: ${name}`,
        400,
      );
    if (info.isDirectory()) {
      yield* walkProject(root, exclusions, excludedName, path);
      continue;
    }
    if (!info.isFile())
      throw new AppError(
        "UNSUPPORTED_PROJECT_ENTRY",
        `Project entry is not a regular file: ${name}`,
        400,
      );
    yield { path, name, size: info.size };
  }
}

async function atomicWriteFile(path: string, contents: string): Promise<void> {
  await assertSafeOutputFile(path);
  const parent = dirname(path),
    expectedParent = await realpath(parent);
  const temporary = join(parent, `.job-${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if ((await realpath(parent)) !== expectedParent)
      throw new AppError(
        "UNSAFE_OUTPUT_DIRECTORY",
        "Artifact output directory changed while writing",
        400,
      );
    await rename(temporary, path);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}
