import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import type {
  JobResponse,
  SourceRenderResponse,
  SourceTicketResponse,
  RenderOutput,
} from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import { validateEntrypointPath } from "@latex-renderer/zip-validation";
import yazl from "yazl";
import { shouldExcludeProjectPath } from "./project-files.js";

export { shouldExcludeProjectPath } from "./project-files.js";

const terminalStatuses = new Set([
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "rejected",
  "deleted",
  "expired",
]);

export interface ClientTransport {
  createSource(
    size: number,
    sha256: string,
    idempotencyKey: string,
  ): Promise<SourceTicketResponse>;
  uploadSource(
    ticket: SourceTicketResponse,
    zipPath: string,
    size: number,
  ): Promise<void>;
  createSourceJob(
    sourceId: string,
    entrypoint: string | undefined,
    idempotencyKey: string,
    outputs?: readonly RenderOutput[],
  ): Promise<SourceRenderResponse>;
  job(jobId: string, jobTicket: string): Promise<JobResponse>;
  renewJobTicket(
    jobId: string,
  ): Promise<{ jobTicket: string; expiresAt: string }>;
  action(
    jobId: string,
    jobTicket: string,
    action: "cancel" | "delete",
  ): Promise<void>;
  artifactUrl(jobId: string, name: string): string;
  previewUrl(jobId: string, page: string): string;
  download(url: string, ticket: string, destination: string): Promise<void>;
}

export type ClientCoreEvent =
  | { type: "archive.created"; size: number; sha256: string; files: number }
  | { type: "source.ready"; sourceId: string; uploadRequired: boolean }
  | { type: "job.queued"; jobId: string }
  | { type: "job.status"; jobId: string; status: JobResponse["status"] }
  | { type: "artifact.downloaded"; name: string; path: string };

export interface ArtifactPaths {
  pdf?: string;
  errors: string;
  log: string;
  job: string;
  previews: string[];
  svg: string[];
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
  onEvent?: (event: ClientCoreEvent) => void;
  outputs?: readonly RenderOutput[];
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
    entrypoint = validateEntrypointPath(options.entrypoint ?? "main.tex");
  const temporary = await mkdtemp(join(tmpdir(), "latex-render-"));
  try {
    const zipPath = join(temporary, "source.zip");
    const prepared = await prepareInputArchive(input, zipPath, entrypoint);
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
    );
    options.onEvent?.({ type: "job.queued", jobId: ticket.jobId });
    const job = await pollJob(client, ticket.jobId, ticket.jobTicket, options);
    const outputDirectory = resolve(
      options.outputDirectory ?? join(prepared.outputRoot, ".render"),
    );
    const artifacts = await downloadArtifacts(
      client,
      job,
      ticket.jobTicket,
      outputDirectory,
      options,
    );
    return { job, outputDirectory, source, artifacts };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function uploadProjectSource(
  client: ClientTransport,
  projectPath: string,
  options: ClientCoreOptions = {},
): Promise<UploadedSource> {
  const temporary = await mkdtemp(join(tmpdir(), "latex-source-"));
  try {
    const zipPath = join(temporary, "source.zip"),
      prepared = await prepareInputArchive(resolve(projectPath), zipPath);
    options.onEvent?.({ type: "archive.created", ...prepared.source });
    return await reserveAndUploadSource(
      client,
      zipPath,
      prepared.source,
      options,
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
  );
  options.onEvent?.({ type: "job.queued", jobId: ticket.jobId });
  return client.job(ticket.jobId, ticket.jobTicket);
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
    );
  options.onEvent?.({ type: "job.queued", jobId: ticket.jobId });
  const job = await pollJob(client, ticket.jobId, ticket.jobTicket, options),
    outputDirectory = resolve(options.outputDirectory ?? ".render"),
    artifacts = await downloadArtifacts(
      client,
      job,
      ticket.jobTicket,
      outputDirectory,
      options,
    );
  return {
    job,
    outputDirectory,
    source: {
      sourceId,
      uploadRequired: false,
      size: job.sourceSize,
      sha256: job.sourceSha256,
      files: 0,
    },
    artifacts,
  };
}

export async function getJob(
  client: ClientTransport,
  jobId: string,
): Promise<JobResponse> {
  const renewed = await client.renewJobTicket(jobId);
  return client.job(jobId, renewed.jobTicket);
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
  options: ClientCoreOptions = {},
): Promise<DownloadArtifactsResult> {
  const renewed = await client.renewJobTicket(jobId);
  const job = await client.job(jobId, renewed.jobTicket);
  const output = resolve(outputDirectory);
  const artifacts = await downloadArtifacts(
    client,
    job,
    renewed.jobTicket,
    output,
    options,
  );
  return { job, outputDirectory: output, artifacts };
}

async function prepareInputArchive(
  input: string,
  destination: string,
  entrypoint?: string,
): Promise<{
  source: { size: number; sha256: string; files: number };
  outputRoot: string;
}> {
  const info = await stat(input).catch(() => undefined);
  if (info?.isDirectory())
    return {
      source: await createProjectArchive(input, destination, entrypoint),
      outputRoot: input,
    };
  if (info?.isFile() && extname(input).toLowerCase() === ".zip") {
    if (entrypoint !== undefined) validateEntrypointPath(entrypoint);
    await pipeline(
      createReadStream(input),
      createWriteStream(destination, { flags: "wx", mode: 0o600 }),
    );
    const archive = await stat(destination);
    if (archive.size <= 0)
      throw new AppError("EMPTY_ARCHIVE", "Source ZIP is empty", 400);
    return {
      source: {
        size: archive.size,
        sha256: await hashFile(destination),
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

async function reserveAndUploadSource(
  client: ClientTransport,
  zipPath: string,
  source: { size: number; sha256: string; files: number },
  options: ClientCoreOptions,
): Promise<UploadedSource> {
  const ticket = await client.createSource(
    source.size,
    source.sha256,
    randomUUID(),
  );
  if (ticket.uploadRequired)
    await client.uploadSource(ticket, zipPath, source.size);
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
): Promise<SourceRenderResponse> {
  return client.createSourceJob(sourceId, entrypoint, randomUUID(), outputs);
}

export async function createProjectArchive(
  root: string,
  destination: string,
  entrypoint?: string,
): Promise<{ size: number; sha256: string; files: number }> {
  const zip = new yazl.ZipFile();
  const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
  const completion = pipeline(zip.outputStream, output);
  let files = 0;
  const requiredEntrypoint =
    entrypoint === undefined ? undefined : validateEntrypointPath(entrypoint);
  let entrypointFound = false,
    texFound = false;
  let ended = false;
  try {
    for (const path of await walk(root)) {
      const name = relative(root, path).replaceAll("\\", "/");
      if (shouldExcludeProjectPath(name)) continue;
      const info = await stat(path);
      if (!info.isFile()) continue;
      if (name === requiredEntrypoint) entrypointFound = true;
      if (extname(name).toLowerCase() === ".tex") texFound = true;
      files += 1;
      if (files > 500)
        throw new AppError(
          "TOO_MANY_FILES",
          "Project has more than 500 files",
          400,
        );
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
  } catch (error) {
    if (!ended) zip.end();
    output.destroy();
    await completion.catch(() => undefined);
    await rm(destination, { force: true });
    throw error;
  }
  const info = await stat(destination);
  return { size: info.size, sha256: await hashFile(destination), files };
}

export async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function pollJob(
  client: ClientTransport,
  jobId: string,
  jobTicket: string,
  options: ClientCoreOptions & {
    pollIntervalMs?: number;
    pollTimeoutMs?: number;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
  },
): Promise<JobResponse> {
  const sleep = options.sleep ?? delay;
  const interval = options.pollIntervalMs ?? 1000;
  const timeout = options.pollTimeoutMs;
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0))
    throw new AppError(
      "INVALID_POLL_TIMEOUT",
      "Poll timeout must be a positive integer",
      400,
    );
  const now = options.now ?? Date.now;
  const startedAt = now();
  for (;;) {
    const job = await client.job(jobId, jobTicket);
    options.onEvent?.({ type: "job.status", jobId, status: job.status });
    if (terminalStatuses.has(job.status)) return job;
    if (timeout !== undefined && now() - startedAt >= timeout)
      throw new AppError(
        "RENDER_POLL_TIMEOUT",
        "Render did not reach a terminal state before the local timeout",
        504,
      );
    await sleep(interval);
  }
}

async function downloadArtifacts(
  client: ClientTransport,
  job: JobResponse,
  jobTicket: string,
  outputDirectory: string,
  options: ClientCoreOptions,
): Promise<ArtifactPaths> {
  await mkdir(outputDirectory, { recursive: true });
  let pdf: string | undefined;
  if (job.status === "succeeded") {
    pdf = join(outputDirectory, "result.pdf");
    await client.download(
      client.artifactUrl(job.id, "result.pdf"),
      jobTicket,
      pdf,
    );
    options.onEvent?.({
      type: "artifact.downloaded",
      name: "result.pdf",
      path: pdf,
    });
  }
  const previews =
    job.status === "succeeded"
      ? await downloadPreviews(
          client,
          job.id,
          jobTicket,
          outputDirectory,
          options,
        )
      : [];
  const errors = join(outputDirectory, "errors.json");
  await client.download(
    client.artifactUrl(job.id, "errors.json"),
    jobTicket,
    errors,
  );
  options.onEvent?.({
    type: "artifact.downloaded",
    name: "errors.json",
    path: errors,
  });
  const log = join(outputDirectory, "compile.log");
  await client.download(
    client.artifactUrl(job.id, "compile.log"),
    jobTicket,
    log,
  );
  options.onEvent?.({
    type: "artifact.downloaded",
    name: "compile.log",
    path: log,
  });
  const jobPath = join(outputDirectory, "job.json");
  await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`, {
    mode: 0o600,
  });
  options.onEvent?.({
    type: "artifact.downloaded",
    name: "job.json",
    path: jobPath,
  });
  const svg: string[] = [];
  for (const artifact of job.artifacts.filter(
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
    await mkdir(dirname(destination), { recursive: true });
    await client.download(
      client.artifactUrl(job.id, artifact.relativePath),
      jobTicket,
      destination,
    );
    svg.push(destination);
    options.onEvent?.({
      type: "artifact.downloaded",
      name: artifact.relativePath,
      path: destination,
    });
  }
  return {
    ...(pdf === undefined ? {} : { pdf }),
    errors,
    log,
    job: jobPath,
    previews,
    svg,
  };
}

async function downloadPreviews(
  client: ClientTransport,
  jobId: string,
  ticket: string,
  output: string,
  options: ClientCoreOptions,
): Promise<string[]> {
  const directory = join(output, "previews");
  await mkdir(directory, { recursive: true });
  const previews: string[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const name = `page-${page}.png`;
    const destination = join(directory, name);
    try {
      await client.download(
        client.previewUrl(jobId, name),
        ticket,
        destination,
      );
      previews.push(destination);
      options.onEvent?.({
        type: "artifact.downloaded",
        name: `previews/${name}`,
        path: destination,
      });
    } catch (error) {
      if (error instanceof AppError && error.status === 404) break;
      throw error;
    }
  }
  return previews;
}

async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink())
      throw new AppError(
        "SYMLINK_REJECTED",
        `Symlink is not allowed: ${entry.name}`,
        400,
      );
    if (entry.isDirectory()) result.push(...(await walk(path)));
    else result.push(path);
  }
  return result;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
