import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  jobResponseSchema,
  projectPageSchema,
  projectDetailSchema,
  projectRevisionJobsPageSchema,
  projectIdSchema,
  attachProjectRevisionResponseSchema,
  sourceRenderResponseSchema,
  sourceTicketResponseSchema,
  ticketResponseSchema,
  type JobResponse,
  type ProjectPage,
  type ProjectDetail,
  type AttachProjectRevisionResponse,
  type RenderOutput,
  type SourceRenderResponse,
  type SourceTicketResponse,
  type TicketResponse,
} from "@latex-renderer/contracts";
import {
  AppError,
  PUBLIC_API_PREFIX,
  credentialUrl,
  trustedCredentialUrl,
} from "@latex-renderer/shared";
import { z } from "zod";

export class RendererClient {
  readonly #baseUrl: URL;
  readonly #trustedOrigins: readonly string[];
  constructor(
    baseUrl: string,
    private readonly apiKey: string,
    options: RendererClientOptions = {},
  ) {
    this.#baseUrl = credentialUrl(baseUrl);
    this.#trustedOrigins = [
      this.#baseUrl.origin,
      ...(options.trustedRendererOrigins ?? []),
    ];
    for (const origin of this.#trustedOrigins) credentialUrl(origin);
  }
  async createTicket(
    size: number,
    sha256: string,
    idempotencyKey: string,
  ): Promise<TicketResponse> {
    const response = await fetch(
      new URL(`${PUBLIC_API_PREFIX}/render-tickets`, this.#baseUrl),
      {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        }),
        body: JSON.stringify({ size, sha256 }),
        redirect: "error",
      },
    );
    return ticketResponseSchema.parse(await responseJson(response));
  }
  async upload(
    ticket: TicketResponse,
    zipPath: string,
    size: number,
  ): Promise<void> {
    const response = await fetch(this.credentialTarget(ticket.uploadUrl), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ticket.uploadTicket}`,
        "Content-Type": "application/zip",
        "Content-Length": String(size),
      },
      body: Readable.toWeb(createReadStream(zipPath)) as ReadableStream,
      duplex: "half",
      redirect: "error",
    } as RequestInit & { duplex: "half" });
    if (!response.ok) await throwResponse(response);
  }
  async createSource(
    size: number,
    sha256: string,
    idempotencyKey: string,
  ): Promise<SourceTicketResponse> {
    const response = await fetch(
      new URL(`${PUBLIC_API_PREFIX}/source-tickets`, this.#baseUrl),
      {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        }),
        body: JSON.stringify({ size, sha256 }),
        redirect: "error",
      },
    );
    return sourceTicketResponseSchema.parse(await responseJson(response));
  }
  async uploadSource(
    ticket: SourceTicketResponse,
    zipPath: string,
    size: number,
  ): Promise<void> {
    if (!ticket.uploadRequired) return;
    if (ticket.uploadTicket === undefined || ticket.uploadUrl === undefined)
      throw new AppError(
        "INVALID_SOURCE_TICKET",
        "Source upload response is incomplete",
        502,
      );
    const response = await fetch(this.credentialTarget(ticket.uploadUrl), {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${ticket.uploadTicket}`,
        "Content-Type": "application/zip",
        "Content-Length": String(size),
      },
      body: Readable.toWeb(createReadStream(zipPath)) as ReadableStream,
      duplex: "half",
      redirect: "error",
    } as RequestInit & { duplex: "half" });
    if (!response.ok) await throwResponse(response);
  }
  async createSourceJob(
    sourceId: string,
    entrypoint: string | undefined,
    idempotencyKey: string,
    outputs: readonly RenderOutput[] = ["pdf"],
  ): Promise<SourceRenderResponse> {
    const response = await fetch(
      new URL(`${PUBLIC_API_PREFIX}/render-tickets`, this.#baseUrl),
      {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        }),
        body: JSON.stringify({
          sourceId,
          entrypoint: entrypoint ?? "main.tex",
          outputs,
        }),
        redirect: "error",
      },
    );
    return sourceRenderResponseSchema.parse(await responseJson(response));
  }
  async listProjects(
    options: {
      cursor?: string | undefined;
      pageSize?: number | undefined;
    } = {},
  ): Promise<ProjectPage> {
    const url = new URL(`${PUBLIC_API_PREFIX}/projects`, this.#baseUrl);
    if (options.cursor !== undefined)
      url.searchParams.set("cursor", options.cursor);
    if (options.pageSize !== undefined)
      url.searchParams.set("pageSize", String(options.pageSize));
    const response = await fetch(url, {
      headers: noStoreRequestHeaders(this.headers()),
      cache: "no-store",
      redirect: "error",
    });
    return projectPageSchema.parse(await responseJson(response));
  }
  async getProject(
    id: string,
    options: {
      cursor?: string | undefined;
      pageSize?: number | undefined;
    } = {},
  ): Promise<ProjectDetail> {
    const url = new URL(
      `${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(id)}`,
      this.#baseUrl,
    );
    if (options.cursor !== undefined)
      url.searchParams.set("cursor", options.cursor);
    if (options.pageSize !== undefined)
      url.searchParams.set("pageSize", String(options.pageSize));
    const response = await fetch(url, {
      headers: noStoreRequestHeaders(this.headers()),
      cache: "no-store",
      redirect: "error",
    });
    return projectDetailSchema.parse(await responseJson(response));
  }
  async listProjectRevisionJobs(
    projectId: string,
    revisionId: string,
    options: {
      cursor?: string | undefined;
      pageSize?: number | undefined;
    } = {},
  ) {
    const url = new URL(
      `${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/jobs`,
      this.#baseUrl,
    );
    if (options.cursor !== undefined)
      url.searchParams.set("cursor", options.cursor);
    if (options.pageSize !== undefined)
      url.searchParams.set("pageSize", String(options.pageSize));
    const response = await fetch(url, {
      headers: noStoreRequestHeaders(this.headers()),
      cache: "no-store",
      redirect: "error",
    });
    return projectRevisionJobsPageSchema.parse(await responseJson(response));
  }
  async createProject(displayName: string): Promise<{ id: string }> {
    const response = await fetch(
      new URL(`${PUBLIC_API_PREFIX}/projects`, this.#baseUrl),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ displayName }),
        redirect: "error",
      },
    );
    return z
      .object({ id: projectIdSchema })
      .parse(await responseJson(response));
  }
  async renameProject(
    id: string,
    displayName: string,
  ): Promise<{ id: string; displayName: string }> {
    const response = await fetch(
      new URL(
        `${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(id)}`,
        this.#baseUrl,
      ),
      {
        method: "PATCH",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ displayName }),
        redirect: "error",
      },
    );
    return z
      .object({ id: projectIdSchema, displayName: z.string() })
      .parse(await responseJson(response));
  }
  async deleteProject(id: string): Promise<void> {
    const response = await fetch(
      new URL(
        `${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(id)}`,
        this.#baseUrl,
      ),
      {
        method: "DELETE",
        headers: this.headers(),
        redirect: "error",
      },
    );
    await responseJson(response);
  }
  async attachProjectRevision(input: {
    projectId: string;
    sourceId: string;
    entrypoint: string;
    displayName: string;
    originalFilename: string;
    outputs?: readonly RenderOutput[];
  }): Promise<AttachProjectRevisionResponse> {
    const response = await fetch(
      new URL(
        `${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(input.projectId)}/revisions`,
        this.#baseUrl,
      ),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          sourceId: input.sourceId,
          entrypoint: input.entrypoint,
          displayName: input.displayName,
          originalFilename: input.originalFilename,
          outputs: input.outputs ?? ["pdf"],
        }),
        redirect: "error",
      },
    );
    return attachProjectRevisionResponseSchema.parse(
      await responseJson(response),
    );
  }
  async renderProjectRevision(
    projectId: string,
    revisionId: string,
    idempotencyKey: string,
    outputs?: readonly RenderOutput[],
  ) {
    const response = await fetch(
      new URL(
        `${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/render`,
        this.#baseUrl,
      ),
      {
        method: "POST",
        headers: this.headers({
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        }),
        body: JSON.stringify(outputs === undefined ? {} : { outputs }),
        redirect: "error",
      },
    );
    return sourceRenderResponseSchema
      .extend({
        projectId: projectIdSchema,
        revisionId: z.string().regex(/^revision_[a-f0-9]{32}$/),
      })
      .parse(await responseJson(response));
  }
  async job(
    ...args:
      | [
          jobId: string,
          jobTicket: string,
          options?: RendererRequestOptions | undefined,
        ]
      | [
          rendererUrl: string,
          jobId: string,
          jobTicket: string,
          options?: RendererRequestOptions | undefined,
        ]
  ): Promise<JobResponse> {
    let base: string, jobId: string, ticket: string, path: string;
    let options: RendererRequestOptions | undefined;
    // A third options object is not the legacy three-string overload.
    if (typeof args[2] === "string") {
      base = args[0];
      jobId = args[1];
      ticket = args[2];
      options = args[3];
      path = `/v1/jobs/${jobId}`;
    } else {
      [jobId, ticket] = args;
      options = args[2];
      base = this.#baseUrl.toString();
      path = `${PUBLIC_API_PREFIX}/jobs/${jobId}`;
    }
    const response = await fetch(
      freshUrl(this.credentialTarget(new URL(path, base))),
      {
        headers: noStoreRequestHeaders({ Authorization: `Bearer ${ticket}` }),
        cache: "no-store",
        redirect: "error",
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    return jobResponseSchema.parse(await responseJson(response));
  }
  async renewJobTicket(
    jobId: string,
    options?: RendererRequestOptions,
  ): Promise<{ jobTicket: string; expiresAt: string }> {
    const response = await fetch(
      new URL(`${PUBLIC_API_PREFIX}/job-tickets/${jobId}`, this.#baseUrl),
      {
        method: "POST",
        headers: this.headers(),
        redirect: "error",
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
      },
    );
    return ticketRenewalSchema.parse(await responseJson(response));
  }
  async action(
    ...args:
      | [jobId: string, jobTicket: string, action: "cancel" | "delete"]
      | [
          rendererUrl: string,
          jobId: string,
          jobTicket: string,
          action: "cancel" | "delete",
        ]
  ): Promise<void> {
    let base: string,
      jobId: string,
      ticket: string,
      action: "cancel" | "delete",
      prefix: string;
    if (args.length === 4) {
      [base, jobId, ticket, action] = args;
      prefix = "/v1";
    } else {
      [jobId, ticket, action] = args;
      base = this.#baseUrl.toString();
      prefix = PUBLIC_API_PREFIX;
    }
    const url = this.credentialTarget(
        new URL(
          `${prefix}/jobs/${jobId}${action === "cancel" ? "/cancel" : ""}`,
          base,
        ),
      ),
      response = await fetch(url, {
        method: action === "cancel" ? "POST" : "DELETE",
        headers: { Authorization: `Bearer ${ticket}` },
        redirect: "error",
      });
    if (!response.ok) await throwResponse(response);
  }
  jobUrl(jobId: string): string {
    return new URL(
      `${PUBLIC_API_PREFIX}/jobs/${jobId}`,
      this.#baseUrl,
    ).toString();
  }
  artifactUrl(jobId: string, name: string): string {
    return new URL(
      `${PUBLIC_API_PREFIX}/jobs/${jobId}/artifacts/${name.split("/").map(encodeURIComponent).join("/")}`,
      this.#baseUrl,
    ).toString();
  }
  previewUrl(jobId: string, page: string): string {
    return new URL(
      `${PUBLIC_API_PREFIX}/jobs/${jobId}/previews/${encodeURIComponent(page)}`,
      this.#baseUrl,
    ).toString();
  }
  async download(
    url: string,
    ticket: string,
    destination: string,
    expected: { size: number; sha256: string },
  ): Promise<void> {
    const target = this.credentialTarget(url);
    if (
      !Number.isSafeInteger(expected.size) ||
      expected.size < 0 ||
      !/^[a-f0-9]{64}$/.test(expected.sha256)
    )
      throw new AppError(
        "INVALID_ARTIFACT_METADATA",
        "Artifact size and SHA-256 are required",
        502,
      );
    const response = await fetch(freshUrl(target), {
      headers: noStoreRequestHeaders({ Authorization: `Bearer ${ticket}` }),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) await throwResponse(response);
    if (response.body === null)
      throw new AppError("EMPTY_DOWNLOAD", "Artifact response body is empty");
    const temporary = `${destination}.part-${randomUUID()}`;
    try {
      const existing = await lstat(destination).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      });
      if (
        existing !== undefined &&
        (existing.isSymbolicLink() ||
          !existing.isFile() ||
          existing.nlink !== 1)
      )
        throw new AppError(
          "UNSAFE_OUTPUT_PATH",
          "Artifact destination must not be a symbolic link",
          400,
        );
      const hash = createHash("sha256");
      let size = 0;
      const verifier = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.length;
          if (size > expected.size)
            return callback(
              new AppError(
                "ARTIFACT_INTEGRITY_MISMATCH",
                "Artifact exceeds its advertised size",
                502,
              ),
            );
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(
          response.body as import("node:stream/web").ReadableStream<Uint8Array>,
        ),
        verifier,
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      if (size !== expected.size || hash.digest("hex") !== expected.sha256)
        throw new AppError(
          "ARTIFACT_INTEGRITY_MISMATCH",
          "Artifact size or SHA-256 does not match Job metadata",
          502,
        );
      const current = await lstat(destination).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
          return undefined;
        throw error;
      });
      if (
        current !== undefined &&
        (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1)
      )
        throw new AppError(
          "UNSAFE_OUTPUT_PATH",
          "Artifact destination changed while downloading",
          400,
        );
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      await response.body.cancel().catch(() => undefined);
      throw error;
    }
  }
  private credentialTarget(value: string | URL): URL {
    return trustedCredentialUrl(value, this.#trustedOrigins);
  }
  private headers(
    extra: Readonly<Record<string, string>> = {},
  ): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, ...extra };
  }
}
export interface RendererRequestOptions {
  readonly signal?: AbortSignal | undefined;
}
export interface RendererClientOptions {
  readonly trustedRendererOrigins?: readonly string[];
}
function freshUrl(url: URL): URL {
  url.searchParams.set("fresh", `${Date.now()}-${randomUUID()}`);
  return url;
}
function noStoreRequestHeaders(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...headers, "Cache-Control": "no-store", Pragma: "no-cache" };
}
const ticketRenewalSchema = z.object({
  jobTicket: z.string().min(1),
  expiresAt: z.iso.datetime(),
});
async function responseJson(response: Response): Promise<unknown> {
  const value: unknown = await (response.json() as Promise<unknown>).catch(
    () => ({
      error: {
        code: "INVALID_RESPONSE",
        message: "Server returned invalid JSON",
      },
    }),
  );
  if (!response.ok) throwFromValue(response.status, value);
  return value;
}
async function throwResponse(response: Response): Promise<never> {
  throwFromValue(
    response.status,
    await (response.json() as Promise<unknown>).catch(() => null),
  );
}
function throwFromValue(status: number, value: unknown): never {
  if (typeof value === "object" && value !== null && "error" in value) {
    const error = (value as { error?: { code?: unknown; message?: unknown } })
      .error;
    if (typeof error?.code === "string" && typeof error.message === "string")
      throw new AppError(error.code, error.message, status);
  }
  throw new AppError(
    "HTTP_ERROR",
    `HTTP request failed with status ${status}`,
    status,
  );
}
