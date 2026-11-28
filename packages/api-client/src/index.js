import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { jobResponseSchema, projectPageSchema, projectDetailSchema, projectRevisionJobsPageSchema, projectIdSchema, projectRevisionIdSchema, attachProjectRevisionResponseSchema, sourceRenderResponseSchema, sourceTicketResponseSchema, ticketResponseSchema, } from "@latex-renderer/contracts";
import { rendererApiAuthoringRoutes, savedRevisionFilesPageSchema, savedRevisionFileTextSchema, } from "@latex-renderer/contracts/renderer-mcp-definitions";
import { AppError, PUBLIC_API_PREFIX, credentialUrl, trustedCredentialUrl, } from "@latex-renderer/shared";
import { z } from "zod";
export class RendererClient {
    apiKey;
    #baseUrl;
    #trustedOrigins;
    constructor(baseUrl, apiKey, options = {}) {
        this.apiKey = apiKey;
        this.#baseUrl = credentialUrl(baseUrl);
        this.#trustedOrigins = [
            this.#baseUrl.origin,
            ...(options.trustedRendererOrigins ?? []),
        ];
        for (const origin of this.#trustedOrigins)
            credentialUrl(origin);
    }
    async createTicket(size, sha256, idempotencyKey, engine) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/render-tickets`, this.#baseUrl), {
            method: "POST",
            headers: this.headers({
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
            }),
            body: JSON.stringify({ size, sha256, engine }),
            redirect: "error",
        });
        return ticketResponseSchema.parse(await responseJson(response));
    }
    async retrySvgJob(jobId, idempotencyKey, options) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/render-tickets`, this.#baseUrl), {
            method: "POST",
            headers: this.headers({
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
            }),
            body: JSON.stringify({ retrySvgJobId: jobId }),
            redirect: "error",
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        return sourceRenderResponseSchema.parse(await responseJson(response));
    }
    async upload(ticket, zipPath, size) {
        const response = await fetch(this.credentialTarget(ticket.uploadUrl), {
            method: "PUT",
            headers: {
                Authorization: `Bearer ${ticket.uploadTicket}`,
                "Content-Type": "application/zip",
                "Content-Length": String(size),
            },
            body: Readable.toWeb(createReadStream(zipPath)),
            duplex: "half",
            redirect: "error",
        });
        if (!response.ok)
            await throwResponse(response);
    }
    async sourceLimits(options) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/source-tickets`, this.#baseUrl), {
            headers: noStoreRequestHeaders(this.headers()),
            redirect: "error",
            ...(options?.signal ? { signal: options.signal } : {}),
        });
        if (response.status === 404 || response.status === 405) {
            await response.body?.cancel();
            return undefined;
        }
        const limits = z.object({
            maxUploadBytes: z.int().positive(),
            maxExtractedBytes: z.int().positive(),
            maxFileCount: z.int().positive(),
            maxZipEntries: z.int().positive(),
        }).safeParse(await responseJson(response));
        if (!limits.success)
            throw new AppError("INVALID_RESPONSE", "Server returned invalid Source limits", 502);
        return limits.data;
    }
    async createSource(size, sha256, idempotencyKey, options) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/source-tickets`, this.#baseUrl), {
            method: "POST",
            headers: this.headers({
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
            }),
            body: JSON.stringify({ size, sha256 }),
            redirect: "error",
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        return sourceTicketResponseSchema.parse(await responseJson(response));
    }
    async uploadSource(ticket, zipPath, size, options) {
        if (!ticket.uploadRequired)
            return;
        if (ticket.uploadTicket === undefined || ticket.uploadUrl === undefined)
            throw new AppError("INVALID_SOURCE_TICKET", "Source upload response is incomplete", 502);
        const url = this.credentialTarget(ticket.uploadUrl);
        const signal = options?.signal;
        signal?.throwIfAborted();
        const source = createReadStream(zipPath, signal ? { signal } : undefined);
        try {
            const response = await fetch(url, {
                method: "PUT",
                headers: {
                    Authorization: `Bearer ${ticket.uploadTicket}`,
                    "Content-Type": "application/zip",
                    "Content-Length": String(size),
                },
                body: Readable.toWeb(source),
                duplex: "half",
                redirect: "error",
                ...(signal === undefined ? {} : { signal }),
            });
            if (!response.ok)
                await throwResponse(response);
        }
        finally {
            if (!source.closed) {
                await new Promise((resolve) => {
                    source.once("close", resolve);
                    source.destroy();
                });
            }
        }
    }
    async createSourceJob(sourceId, entrypoint, idempotencyKey, outputs = ["pdf"], engine, options) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/render-tickets`, this.#baseUrl), {
            method: "POST",
            headers: this.headers({
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
            }),
            body: JSON.stringify({
                sourceId,
                entrypoint: entrypoint ?? "main.tex",
                outputs,
                engine,
            }),
            redirect: "error",
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        return sourceRenderResponseSchema.parse(await responseJson(response));
    }
    async listProjects(options = {}) {
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
    async getProject(id, options = {}) {
        const url = new URL(`${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(id)}`, this.#baseUrl);
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
    async listProjectRevisionJobs(projectId, revisionId, options = {}) {
        const url = new URL(`${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/jobs`, this.#baseUrl);
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
    async listProjectRevisionFiles(projectId, revisionId, options = {}) {
        const query = new URLSearchParams();
        if (options.offset !== undefined)
            query.set("offset", String(options.offset));
        if (options.limit !== undefined)
            query.set("limit", String(options.limit));
        return savedRevisionFilesPageSchema.parse(await this.#readProjectRevisionFiles(projectId, revisionId, query, options.signal));
    }
    async runAuthoringOperation(operation, input, options = {}) {
        const route = rendererApiAuthoringRoutes[operation];
        const idKey = route.resource === "project" ? "projectId" : "jobId";
        const { [idKey]: id, ...parameters } = input;
        const pattern = route.resource === "project" ? /^project_[a-f0-9]{32}$/ : /^job_[a-f0-9]{32}$/;
        if (typeof id !== "string" || !pattern.test(id))
            throw new AppError("INVALID_REQUEST", "A valid Project or Job ID is required", 400);
        const collection = route.resource === "project" ? "projects" : "job-tickets";
        const url = new URL(`${PUBLIC_API_PREFIX}/${collection}/${encodeURIComponent(id)}${route.suffix}`, this.#baseUrl);
        if (route.method === "GET")
            for (const [key, value] of Object.entries(parameters)) {
                if (typeof value === "number" || typeof value === "string")
                    url.searchParams.set(key, String(value));
                else if (operation === "get_project_document_state" &&
                    key === "history" &&
                    value !== undefined)
                    url.searchParams.set(key, JSON.stringify(value));
            }
        const hasBody = route.method !== "GET";
        const response = await fetch(url, {
            method: route.method,
            headers: noStoreRequestHeaders(this.headers(hasBody ? { "Content-Type": "application/json" } : undefined)),
            cache: "no-store",
            redirect: "error",
            ...(hasBody ? { body: JSON.stringify(parameters) } : {}),
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        return await authoringResponse(response, route.resource === "job");
    }
    async downloadProjectRevisionSource(projectId, revisionId, destination, options = {}) {
        const path = `${PUBLIC_API_PREFIX}/projects/${projectIdSchema.parse(projectId)}/revisions/${projectRevisionIdSchema.parse(revisionId)}/source.zip`;
        const response = await fetch(new URL(path, this.#baseUrl), {
            headers: noStoreRequestHeaders(this.headers()),
            cache: "no-store",
            redirect: "error",
            ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
        if (!response.ok)
            await authoringResponse(response);
        const length = response.headers.get("X-Source-Zip-Size") ?? "";
        const size = Number(length);
        const sha256 = /^"([a-f0-9]{64})"$/.exec(response.headers.get("ETag") ?? "")?.[1];
        if (response.status !== 200 ||
            response.headers.get("Content-Type") !== "application/zip" ||
            !/^\d+$/.test(length) ||
            !Number.isSafeInteger(size) ||
            sha256 === undefined) {
            await response.body?.cancel();
            throw new AppError("INVALID_ARTIFACT_METADATA", "Saved Source ZIP size and SHA-256 are required", 502);
        }
        await this.#saveDownload(response, destination, { size, sha256 }, options.signal);
        return { size, sha256 };
    }
    async getProjectRevisionFile(projectId, revisionId, path, options = {}) {
        const query = new URLSearchParams({ path });
        if (options.offset !== undefined)
            query.set("offset", String(options.offset));
        return savedRevisionFileTextSchema.parse(await this.#readProjectRevisionFiles(projectId, revisionId, query, options.signal));
    }
    async #readProjectRevisionFiles(projectId, revisionId, query, signal) {
        const url = new URL(`${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/files`, this.#baseUrl);
        url.search = query.toString();
        const response = await fetch(url, {
            headers: noStoreRequestHeaders(this.headers()),
            cache: "no-store",
            redirect: "error",
            ...(signal === undefined ? {} : { signal }),
        });
        return await authoringResponse(response);
    }
    async createProject(displayName) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/projects`, this.#baseUrl), {
            method: "POST",
            headers: this.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ displayName }),
            redirect: "error",
        });
        return z
            .object({ id: projectIdSchema })
            .parse(await responseJson(response));
    }
    async renameProject(id, displayName) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(id)}`, this.#baseUrl), {
            method: "PATCH",
            headers: this.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ displayName }),
            redirect: "error",
        });
        return z
            .object({ id: projectIdSchema, displayName: z.string() })
            .parse(await responseJson(response));
    }
    async deleteProject(id) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(id)}`, this.#baseUrl), {
            method: "DELETE",
            headers: this.headers(),
            redirect: "error",
        });
        await responseJson(response);
    }
    async attachProjectRevision(input, options) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(input.projectId)}/revisions`, this.#baseUrl), {
            method: "POST",
            headers: this.headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({
                sourceId: input.sourceId,
                entrypoint: input.entrypoint,
                displayName: input.displayName,
                originalFilename: input.originalFilename,
                outputs: input.outputs ?? ["pdf"],
                engine: input.engine,
            }),
            redirect: "error",
            ...(options?.signal ? { signal: options.signal } : {}),
        });
        return attachProjectRevisionResponseSchema.parse(await responseJson(response));
    }
    async renderProjectRevision(projectId, revisionId, idempotencyKey, outputs) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/render`, this.#baseUrl), {
            method: "POST",
            headers: this.headers({
                "Content-Type": "application/json",
                "Idempotency-Key": idempotencyKey,
            }),
            body: JSON.stringify(outputs === undefined ? {} : { outputs }),
            redirect: "error",
        });
        return sourceRenderResponseSchema
            .extend({
            projectId: projectIdSchema,
            revisionId: z.string().regex(/^revision_[a-f0-9]{32}$/),
        })
            .parse(await responseJson(response));
    }
    async job(...args) {
        let base, jobId, ticket, path;
        let options;
        // A third options object is not the legacy three-string overload.
        if (typeof args[2] === "string") {
            base = args[0];
            jobId = args[1];
            ticket = args[2];
            options = args[3];
            path = `/v1/jobs/${jobId}`;
        }
        else {
            [jobId, ticket] = args;
            options = args[2];
            base = this.#baseUrl.toString();
            path = `${PUBLIC_API_PREFIX}/jobs/${jobId}`;
        }
        const response = await fetch(freshUrl(this.credentialTarget(new URL(path, base))), {
            headers: noStoreRequestHeaders({ Authorization: `Bearer ${ticket}` }),
            cache: "no-store",
            redirect: "error",
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        return jobResponseSchema.parse(await responseJson(response));
    }
    async renewJobTicket(jobId, options) {
        const response = await fetch(new URL(`${PUBLIC_API_PREFIX}/job-tickets/${jobId}`, this.#baseUrl), {
            method: "POST",
            headers: this.headers(),
            redirect: "error",
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        return ticketRenewalSchema.parse(await responseJson(response));
    }
    async action(...args) {
        let base, jobId, ticket, action, prefix;
        if (args.length === 4) {
            [base, jobId, ticket, action] = args;
            prefix = "/v1";
        }
        else {
            [jobId, ticket, action] = args;
            base = this.#baseUrl.toString();
            prefix = PUBLIC_API_PREFIX;
        }
        const url = this.credentialTarget(new URL(`${prefix}/jobs/${jobId}${action === "cancel" ? "/cancel" : ""}`, base)), response = await fetch(url, {
            method: action === "cancel" ? "POST" : "DELETE",
            headers: { Authorization: `Bearer ${ticket}` },
            redirect: "error",
        });
        if (!response.ok)
            await throwResponse(response);
    }
    jobUrl(jobId) {
        return new URL(`${PUBLIC_API_PREFIX}/jobs/${jobId}`, this.#baseUrl).toString();
    }
    artifactUrl(jobId, name) {
        return new URL(`${PUBLIC_API_PREFIX}/jobs/${jobId}/artifacts/${name.split("/").map(encodeURIComponent).join("/")}`, this.#baseUrl).toString();
    }
    previewUrl(jobId, page) {
        return new URL(`${PUBLIC_API_PREFIX}/jobs/${jobId}/previews/${encodeURIComponent(page)}`, this.#baseUrl).toString();
    }
    /** Request one page, then let the caller fetch real Job metadata before a
     * verified download. No invented checksum and no whole-PNG buffer. */
    async preparePreview(jobId, page, ticket, options = {}) {
        if (!Number.isSafeInteger(page) || page < 1 || page > 100)
            throw new AppError("PREVIEW_PAGE_INVALID", "Preview page must be 1..100", 400);
        const target = this.credentialTarget(this.previewUrl(jobId, `page-${page}.png`)), deadline = Date.now() + 60_000;
        for (let attempt = 0; attempt < 6 && Date.now() < deadline; attempt++) {
            options.signal?.throwIfAborted();
            const timeout = AbortSignal.timeout(Math.max(1, deadline - Date.now())), signal = options.signal
                ? AbortSignal.any([options.signal, timeout])
                : timeout;
            const response = await fetch(freshUrl(target), {
                headers: noStoreRequestHeaders({ Authorization: `Bearer ${ticket}` }),
                cache: "no-store",
                redirect: "error",
                signal,
            });
            if (response.ok) {
                await response.body?.cancel();
                return;
            }
            if (response.status !== 503)
                await throwResponse(response);
            const body = await response.json();
            const error = typeof body === "object" && body !== null && "error" in body
                ? body.error
                : undefined;
            if (typeof error !== "object" ||
                error === null ||
                !("code" in error) ||
                typeof error.code !== "string" ||
                !["PREVIEW_PENDING", "PREVIEW_BUSY", "PREVIEW_QUEUE_FULL"].includes(error.code))
                throwFromValue(response.status, body);
            if (attempt < 5 && Date.now() + 2000 < deadline)
                await delay(2000, undefined, options.signal ? { signal: options.signal } : undefined);
        }
        throw new AppError("PREVIEW_PENDING", "Preview is not ready; retry shortly", 503);
    }
    async download(url, ticket, destination, expected, options) {
        const target = this.credentialTarget(url);
        if (!Number.isSafeInteger(expected.size) ||
            expected.size < 0 ||
            !/^[a-f0-9]{64}$/.test(expected.sha256))
            throw new AppError("INVALID_ARTIFACT_METADATA", "Artifact size and SHA-256 are required", 502);
        const response = await fetch(freshUrl(target), {
            headers: noStoreRequestHeaders({ Authorization: `Bearer ${ticket}` }),
            cache: "no-store",
            redirect: "error",
            ...(options?.signal === undefined ? {} : { signal: options.signal }),
        });
        if (!response.ok)
            await throwResponse(response);
        await this.#saveDownload(response, destination, expected, options?.signal);
    }
    async #saveDownload(response, destination, expected, signal) {
        if (response.body === null)
            throw new AppError("EMPTY_DOWNLOAD", "Artifact response body is empty");
        const temporary = `${destination}.part-${randomUUID()}`;
        try {
            const existing = await lstat(destination).catch((error) => {
                if (error.code === "ENOENT")
                    return undefined;
                throw error;
            });
            if (existing !== undefined &&
                (existing.isSymbolicLink() ||
                    !existing.isFile() ||
                    existing.nlink !== 1))
                throw new AppError("UNSAFE_OUTPUT_PATH", "Artifact destination must not be a symbolic link", 400);
            const hash = createHash("sha256");
            let size = 0;
            const verifier = new Transform({
                transform(chunk, _encoding, callback) {
                    size += chunk.length;
                    if (size > expected.size)
                        return callback(new AppError("ARTIFACT_INTEGRITY_MISMATCH", "Artifact exceeds its advertised size", 502));
                    hash.update(chunk);
                    callback(null, chunk);
                },
            });
            await pipeline(Readable.fromWeb(response.body), verifier, createWriteStream(temporary, { flags: "wx", mode: 0o600 }), signal === undefined ? {} : { signal });
            if (size !== expected.size || hash.digest("hex") !== expected.sha256)
                throw new AppError("ARTIFACT_INTEGRITY_MISMATCH", "Download size or SHA-256 does not match its metadata", 502);
            const current = await lstat(destination).catch((error) => {
                if (error.code === "ENOENT")
                    return undefined;
                throw error;
            });
            if (current !== undefined &&
                (current.isSymbolicLink() || !current.isFile() || current.nlink !== 1))
                throw new AppError("UNSAFE_OUTPUT_PATH", "Artifact destination changed while downloading", 400);
            signal?.throwIfAborted();
            await rename(temporary, destination);
        }
        catch (error) {
            await rm(temporary, { force: true }).catch(() => undefined);
            await response.body.cancel().catch(() => undefined);
            throw error;
        }
    }
    credentialTarget(value) {
        return trustedCredentialUrl(value, this.#trustedOrigins);
    }
    headers(extra = {}) {
        return { Authorization: `Bearer ${this.apiKey}`, ...extra };
    }
}
function freshUrl(url) {
    url.searchParams.set("fresh", `${Date.now()}-${randomUUID()}`);
    return url;
}
function noStoreRequestHeaders(headers) {
    return { ...headers, "Cache-Control": "no-store", Pragma: "no-cache" };
}
const ticketRenewalSchema = z.object({
    jobTicket: z.string().min(1),
    expiresAt: z.iso.datetime(),
});
async function responseJson(response) {
    const value = await response.json().catch(() => ({
        error: {
            code: "INVALID_RESPONSE",
            message: "Server returned invalid JSON",
        },
    }));
    if (!response.ok)
        throwFromValue(response.status, value);
    return value;
}
async function authoringResponse(response, legacyJobRoute = false) {
    try {
        return await responseJson(response);
    }
    catch (error) {
        if (error instanceof AppError && (error.status === 405 ||
            (error.status === 404 && ["NOT_FOUND", "INVALID_RESPONSE", "HTTP_ERROR"].includes(error.code)) ||
            (legacyJobRoute && error.status === 400 && error.code === "INVALID_JOB_ID")))
            throw new AppError("AUTHORING_UNAVAILABLE", "This server does not support the requested Local MCP authoring operation. Update the server or use its Web editor or Remote MCP.", 501);
        throw error;
    }
}
async function throwResponse(response) {
    throwFromValue(response.status, await response.json().catch(() => null));
}
function throwFromValue(status, value) {
    if (typeof value === "object" && value !== null && "error" in value) {
        const error = value.error;
        if (typeof error?.code === "string" && typeof error.message === "string")
            throw new AppError(error.code, error.message, status, error.code === "PREVIEW_FAILED" &&
                typeof error.previewErrorCode === "string" &&
                typeof error.retryable === "boolean"
                ? {
                    previewErrorCode: error.previewErrorCode,
                    retryable: error.retryable,
                }
                : (error.code === "DRAFT_VERSION_CONFLICT" ||
                    error.code === "DOCUMENT_CONDITIONS_CONFLICT") &&
                    (error.currentVersion === null ||
                        (typeof error.currentVersion === "number" &&
                            Number.isSafeInteger(error.currentVersion) &&
                            error.currentVersion >= 0))
                    ? { currentVersion: error.currentVersion }
                    : undefined);
    }
    throw new AppError("HTTP_ERROR", `HTTP request failed with status ${status}`, status);
}
//# sourceMappingURL=index.js.map