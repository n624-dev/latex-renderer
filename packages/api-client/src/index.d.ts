import { type JobResponse, type ProjectPage, type ProjectDetail, type AttachProjectRevisionResponse, type RenderOutput, type RenderEngine, type SourceRenderResponse, type SourceTicketResponse, type TicketResponse } from "@latex-renderer/contracts";
import { type RendererApiAuthoringTool } from "@latex-renderer/contracts/renderer-mcp-definitions";
import { type ResourceLimits } from "@latex-renderer/shared";
export declare class RendererClient {
    #private;
    private readonly apiKey;
    constructor(baseUrl: string, apiKey: string, options?: RendererClientOptions);
    createTicket(size: number, sha256: string, idempotencyKey: string, engine?: RenderEngine): Promise<TicketResponse>;
    retrySvgJob(jobId: string, idempotencyKey: string, options?: RendererRequestOptions): Promise<SourceRenderResponse>;
    upload(ticket: TicketResponse, zipPath: string, size: number): Promise<void>;
    sourceLimits(options?: RendererRequestOptions): Promise<ResourceLimits | undefined>;
    createSource(size: number, sha256: string, idempotencyKey: string, options?: RendererRequestOptions): Promise<SourceTicketResponse>;
    uploadSource(ticket: SourceTicketResponse, zipPath: string, size: number, options?: RendererRequestOptions): Promise<void>;
    createSourceJob(sourceId: string, entrypoint: string | undefined, idempotencyKey: string, outputs?: readonly RenderOutput[], engine?: RenderEngine, options?: RendererRequestOptions): Promise<SourceRenderResponse>;
    listProjects(options?: {
        cursor?: string | undefined;
        pageSize?: number | undefined;
    }): Promise<ProjectPage>;
    getProject(id: string, options?: {
        cursor?: string | undefined;
        pageSize?: number | undefined;
    }): Promise<ProjectDetail>;
    listProjectRevisionJobs(projectId: string, revisionId: string, options?: {
        cursor?: string | undefined;
        pageSize?: number | undefined;
    }): Promise<{
        items: {
            [x: string]: unknown;
            id: string;
            status: "canceled" | "deleted" | "deleting" | "expired" | "failed" | "queued" | "rejected" | "reserved" | "running" | "succeeded" | "timeout" | "uploading" | "validating";
            createdAt: string;
            updatedAt: string;
            retryOfJobId: string | null;
            errorCode: string | null;
            outputs: ("pdf" | "svg")[];
            engine?: "lualatex" | "pdflatex" | "platex" | "uplatex" | "xelatex" | undefined;
            detailAccess?: "available" | "different_connection" | undefined;
        }[];
        hasMore: boolean;
        nextCursor: string | null;
    }>;
    listProjectRevisionFiles(projectId: string, revisionId: string, options?: RendererRequestOptions & {
        offset?: number | undefined;
        limit?: number | undefined;
    }): Promise<{
        projectId: string;
        revisionId: string;
        sourceId: string;
        sourceSha256: string;
        items: {
            path: string;
            size: number;
            kind: "binary" | "text";
        }[];
        totalFiles: number;
        nextOffset: number | null;
    }>;
    runAuthoringOperation(operation: RendererApiAuthoringTool, input: Readonly<Record<string, unknown>>, options?: RendererRequestOptions): Promise<unknown>;
    downloadProjectRevisionSource(projectId: string, revisionId: string, destination: string, options?: RendererRequestOptions): Promise<{
        size: number;
        sha256: string;
    }>;
    getProjectRevisionFile(projectId: string, revisionId: string, path: string, options?: RendererRequestOptions & {
        offset?: number | undefined;
    }): Promise<{
        projectId: string;
        revisionId: string;
        sourceId: string;
        sourceSha256: string;
        path: string;
        sha256: string;
        size: number;
        text: string;
        unit: "utf16";
        offset: number;
        nextOffset: number | null;
        totalUnits: number;
    }>;
    createProject(displayName: string): Promise<{
        id: string;
    }>;
    renameProject(id: string, displayName: string): Promise<{
        id: string;
        displayName: string;
    }>;
    deleteProject(id: string): Promise<void>;
    attachProjectRevision(input: {
        projectId: string;
        sourceId: string;
        entrypoint: string;
        displayName: string;
        originalFilename: string;
        outputs?: readonly RenderOutput[];
        engine?: RenderEngine | undefined;
    }, options?: RendererRequestOptions): Promise<AttachProjectRevisionResponse>;
    renderProjectRevision(projectId: string, revisionId: string, idempotencyKey: string, outputs?: readonly RenderOutput[]): Promise<{
        jobId: string;
        jobTicket: string;
        expiresAt: string;
        projectId: string;
        revisionId: string;
    }>;
    job(...args: [
        jobId: string,
        jobTicket: string,
        options?: RendererRequestOptions | undefined
    ] | [
        rendererUrl: string,
        jobId: string,
        jobTicket: string,
        options?: RendererRequestOptions | undefined
    ]): Promise<JobResponse>;
    renewJobTicket(jobId: string, options?: RendererRequestOptions): Promise<{
        jobTicket: string;
        expiresAt: string;
    }>;
    action(...args: [jobId: string, jobTicket: string, action: "cancel" | "delete"] | [
        rendererUrl: string,
        jobId: string,
        jobTicket: string,
        action: "cancel" | "delete"
    ]): Promise<void>;
    jobUrl(jobId: string): string;
    artifactUrl(jobId: string, name: string): string;
    previewUrl(jobId: string, page: string): string;
    /** Request one page, then let the caller fetch real Job metadata before a
     * verified download. No invented checksum and no whole-PNG buffer. */
    preparePreview(jobId: string, page: number, ticket: string, options?: RendererRequestOptions): Promise<void>;
    download(url: string, ticket: string, destination: string, expected: {
        size: number;
        sha256: string;
    }, options?: RendererRequestOptions): Promise<void>;
    private credentialTarget;
    private headers;
}
export interface RendererRequestOptions {
    readonly signal?: AbortSignal | undefined;
}
export interface RendererClientOptions {
    readonly trustedRendererOrigins?: readonly string[];
}
//# sourceMappingURL=index.d.ts.map