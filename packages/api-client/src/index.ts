import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  jobResponseSchema,
  sourceRenderResponseSchema,
  sourceTicketResponseSchema,
  ticketResponseSchema,
  type JobResponse,
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
  async job(
    ...args:
      | [jobId: string, jobTicket: string]
      | [rendererUrl: string, jobId: string, jobTicket: string]
  ): Promise<JobResponse> {
    let base: string, jobId: string, ticket: string, path: string;
    if (args.length === 3) {
      [base, jobId, ticket] = args;
      path = `/v1/jobs/${jobId}`;
    } else {
      [jobId, ticket] = args;
      base = this.#baseUrl.toString();
      path = `${PUBLIC_API_PREFIX}/jobs/${jobId}`;
    }
    const response = await fetch(
      freshUrl(this.credentialTarget(new URL(path, base))),
      {
        headers: noStoreRequestHeaders({ Authorization: `Bearer ${ticket}` }),
        cache: "no-store",
        redirect: "error",
      },
    );
    return jobResponseSchema.parse(await responseJson(response));
  }
  async renewJobTicket(
    jobId: string,
  ): Promise<{ jobTicket: string; expiresAt: string }> {
    const response = await fetch(
      new URL(`${PUBLIC_API_PREFIX}/job-tickets/${jobId}`, this.#baseUrl),
      {
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: "{}",
        redirect: "error",
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
  ): Promise<void> {
    const response = await fetch(freshUrl(this.credentialTarget(url)), {
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
      if (existing?.isSymbolicLink())
        throw new AppError(
          "UNSAFE_OUTPUT_PATH",
          "Artifact destination must not be a symbolic link",
          400,
        );
      await pipeline(
        Readable.from(readWebBody(response.body)),
        createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      );
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
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
async function* readWebBody(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return;
      yield part.value;
    }
  } finally {
    reader.releaseLock();
  }
}
