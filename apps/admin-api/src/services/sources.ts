import { AppError, nowIso } from "@latex-renderer/shared";
import type { RenderOutput } from "@latex-renderer/contracts";
import type { AdminActor, AdminDependencies } from "../types.js";
import { AdminJobsService } from "./jobs.js";

export class AdminSourcesService {
  private readonly jobs: AdminJobsService;

  constructor(private readonly deps: AdminDependencies) {
    this.jobs = new AdminJobsService(deps);
  }

  list(filters: { query?: string; status?: string } = {}) {
    const query = filters.query?.trim().toLowerCase();
    return this.deps.database.sources
      .list()
      .filter((source) => {
        if (filters.status && source.status !== filters.status) return false;
        return (
          !query ||
          [source.id, source.owner_user_id, source.sha256].some((value) =>
            value.toLowerCase().includes(query),
          )
        );
      })
      .map((source) => this.summary(source.id));
  }

  get(id: string) {
    return this.summary(id, true);
  }

  async render(
    actor: AdminActor,
    id: string,
    input: { apiKeyId: string; entrypoint?: string | undefined; outputs: RenderOutput[] },
    idempotencyKey: string,
  ) {
    return this.jobs.createRender(
      actor,
      { apiKeyId: input.apiKeyId, sourceId: id, entrypoint: input.entrypoint, outputs: input.outputs },
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

  private summary(id: string, includePaths = false) {
    const source = this.deps.database.sources.get(id);
    if (source === undefined || source.status === "deleted")
      throw new AppError("SOURCE_NOT_FOUND", "Source does not exist", 404);
    const related = this.deps.database.jobs
      .list()
      .filter((job) => job.source_id === source.id)
      .map((job) => ({
        id: job.id,
        status: job.status,
        entrypoint: job.entrypoint,
        created_at: job.created_at,
      }));
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
      jobs: related,
      deletable:
        ["ready", "expired"].includes(source.status) &&
        this.deps.database.sources.referenceCount(source.id) === 0,
    };
  }
}
