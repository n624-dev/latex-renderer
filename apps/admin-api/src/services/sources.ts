import { AppError, nowIso } from "@latex-renderer/shared";
import type { SourceListRow } from "@latex-renderer/database";
import type { RenderOutput } from "@latex-renderer/contracts";
import type { AdminActor, AdminDependencies } from "../types.js";
import { AdminJobsService } from "./jobs.js";

export class AdminSourcesService {
  private readonly jobs: AdminJobsService;

  constructor(private readonly deps: AdminDependencies) {
    this.jobs = new AdminJobsService(deps);
  }

  list(
    filters: {
      query?: string;
      status?: string;
      cursor?: string | undefined;
      limit?: number | undefined;
    } = {},
  ) {
    const page = this.deps.database.sources.listPage(filters);
    return {
      ...page,
      // Related Jobs are represented by SQL aggregates on list pages. The
      // complete history is loaded only on a Source detail page.
      items: page.items.map((source) => this.listSummary(source)),
    };
  }

  get(
    id: string,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    return this.summary(id, true, options);
  }

  async render(
    actor: AdminActor,
    id: string,
    input: {
      apiKeyId: string;
      entrypoint?: string | undefined;
      outputs: RenderOutput[];
    },
    idempotencyKey: string,
  ) {
    return this.jobs.createRender(
      actor,
      {
        apiKeyId: input.apiKeyId,
        sourceId: id,
        entrypoint: input.entrypoint,
        outputs: input.outputs,
      },
      idempotencyKey,
    );
  }

  createRef(actor: AdminActor, id: string, apiKeyId: string) {
    return this.jobs.createSourceRef(actor, { apiKeyId, sourceId: id });
  }

  delete(actor: AdminActor, id: string): void {
    const source = this.deps.database.sources.get(id);
    if (source === undefined || ["deleted", "deleting"].includes(source.status))
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    this.deps.database.transaction(() => {
      if (this.deps.database.sources.markDeleting(id, nowIso()) !== 1)
        throw new AppError(
          "SOURCE_IN_USE",
          "Source cannot be deleted while retained jobs reference it",
          409,
        );
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "admin.source.deleted",
        targetType: "source",
        targetId: id,
        result: "requested",
      });
    });
  }

  private listSummary(source: SourceListRow) {
    return {
      id: source.id,
      owner_user_id: source.owner_user_id,
      status: source.status,
      size: source.size,
      sha256: source.sha256,
      created_at: source.created_at,
      updated_at: source.updated_at,
      uploaded_at: source.uploaded_at,
      expires_at: source.expires_at,
      entrypoints: this.deps.database.sources
        .paths(source)
        .filter((path) => path.toLowerCase().endsWith(".tex")),
      // Keep the old field as an empty list for clients that iterate it, but
      // expose the complete count/latest row without scanning Jobs per Source.
      jobs: [],
      jobCount: source.job_count,
      latestJob:
        source.latest_job_id === null
          ? null
          : {
              id: source.latest_job_id,
              status: source.latest_job_status,
              created_at: source.latest_job_created_at,
            },
      deletable:
        ["ready", "expired"].includes(source.status) &&
        source.blocking_reference_count === 0,
    };
  }

  private summary(
    id: string,
    includePaths = false,
    options: { cursor?: string | undefined; limit?: number | undefined } = {},
  ) {
    const source = this.deps.database.sources.get(id);
    if (source === undefined || source.status === "deleted")
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    const related = this.deps.database.jobs.listBySourcePage(
        source.id,
        options,
      ),
      blockingReferences = this.deps.database.sources.blockingReferenceCount(
        source.id,
      );
    return {
      id: source.id,
      owner_user_id: source.owner_user_id,
      status: source.status,
      size: source.size,
      sha256: source.sha256,
      created_at: source.created_at,
      updated_at: source.updated_at,
      uploaded_at: source.uploaded_at,
      expires_at: source.expires_at,
      entrypoints: this.deps.database.sources
        .paths(source)
        .filter((path) => path.toLowerCase().endsWith(".tex")),
      paths: includePaths
        ? this.deps.database.sources.paths(source)
        : undefined,
      jobs: related.items,
      jobsNextCursor: related.nextCursor,
      jobsHasMore: related.hasMore,
      deletable:
        ["ready", "expired"].includes(source.status) &&
        blockingReferences === 0,
    };
  }
}
