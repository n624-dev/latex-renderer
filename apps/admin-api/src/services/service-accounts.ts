import { AppError, newId, nowIso } from "@latex-renderer/shared";
import type { AdminActor, AdminDependencies } from "../types.js";

type ClientType = "codex" | "claude-code" | "mcp" | "ci" | "generic";

export class ServiceAccountsService {
  constructor(private readonly deps: AdminDependencies) {}
  list(
    options: {
      cursor?: string | undefined;
      limit?: number | undefined;
      query?: string | undefined;
    } = {},
  ) {
    return this.deps.database.serviceAccounts.listPage(options);
  }
  get(id: string) {
    const row = this.deps.database.serviceAccounts.get(id);
    if (row === undefined)
      throw new AppError(
        "SERVICE_ACCOUNT_NOT_FOUND",
        "Service account does not exist",
        404,
      );
    return row;
  }

  create(
    actor: AdminActor,
    input: { ownerUserId: string; name: string; clientType: ClientType },
  ): string {
    if (!this.deps.database.users.activeExists(input.ownerUserId))
      throw new AppError(
        "USER_NOT_FOUND",
        "Active owner user does not exist",
        404,
      );
    const id = newId("sa"),
      timestamp = nowIso();
    this.deps.database.transaction(() => {
      if (
        this.deps.database.serviceAccounts.countActiveForOwner(
          input.ownerUserId,
        ) >= 20
      )
        throw new AppError(
          "SERVICE_ACCOUNT_LIMIT",
          "Active service account limit reached for this user",
          429,
        );
      this.requireAvailableName(input.ownerUserId, input.name);
      this.deps.database.serviceAccounts.insert({ id, ...input, timestamp });
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "service_account.created",
        targetType: "service_account",
        targetId: id,
        result: "success",
      });
    });
    return id;
  }

  changeStatus(
    actor: AdminActor,
    id: string,
    action: "enable" | "disable",
  ): { id: string; status: string } {
    const status = action === "enable" ? "active" : "disabled";
    this.deps.database.transaction(() => {
      const account = this.get(id);
      if (
        status === "active" &&
        account.status !== "active" &&
        this.deps.database.serviceAccounts.countActiveForOwner(
          account.owner_user_id,
        ) >= 20
      )
        throw new AppError(
          "SERVICE_ACCOUNT_LIMIT",
          "Active service account limit reached for this user",
          429,
        );
      if (
        this.deps.database.serviceAccounts.setStatus(id, status, nowIso()) !== 1
      )
        throw new AppError(
          "SERVICE_ACCOUNT_NOT_FOUND",
          "Service account does not exist",
          404,
        );
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: `service_account.${action}d`,
        targetType: "service_account",
        targetId: id,
        result: "success",
      });
    });
    return { id, status };
  }

  update(
    actor: AdminActor,
    id: string,
    input: { name?: string | undefined; clientType?: ClientType | undefined },
  ): void {
    this.deps.database.transaction(() => {
      const account = this.get(id);
      if (input.name !== undefined && input.name !== account.name)
        this.requireAvailableName(account.owner_user_id, input.name);
      if (this.deps.database.serviceAccounts.update(id, input, nowIso()) !== 1)
        throw new AppError(
          "SERVICE_ACCOUNT_NOT_FOUND",
          "Service account does not exist",
          404,
        );
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "service_account.updated",
        targetType: "service_account",
        targetId: id,
        result: "success",
        metadata: input,
      });
    });
  }

  private requireAvailableName(ownerUserId: string, name: string): void {
    if (this.deps.database.serviceAccounts.nameExists(ownerUserId, name))
      throw new AppError(
        "SERVICE_ACCOUNT_NAME_CONFLICT",
        "Service account name is already assigned for this user",
        409,
      );
  }

  delete(actor: AdminActor, id: string): void {
    const timestamp = nowIso();
    this.deps.database.transaction(() => {
      if (
        this.deps.database.serviceAccounts.setStatus(
          id,
          "disabled",
          timestamp,
        ) !== 1
      )
        throw new AppError(
          "SERVICE_ACCOUNT_NOT_FOUND",
          "Service account does not exist",
          404,
        );
      this.deps.database.apiKeys.revokeForServiceAccount(id, timestamp);
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "service_account.deleted",
        targetType: "service_account",
        targetId: id,
        result: "success",
      });
    });
  }
}
