import { AppError, nowIso } from "@latex-renderer/shared";
import type { MaintenanceMode } from "@latex-renderer/contracts";
import { isWorkerHeartbeatFresh } from "../../../../deploy/scripts/worker-health.mjs";
import type { AdminActor, AdminDependencies } from "../types.js";
import {
  runtimeSettingDefinitions,
  runtimeSettingKeys,
  type AuditLogQuery,
  type RuntimeSettingKey,
  type SettingRow,
} from "@latex-renderer/database";

export const ticketRevocationMinimumSeconds = 35 * 60;

function configValue(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    throw new AppError(
      "CONFIG_STATE_INVALID",
      "Current resource limit is invalid",
      409,
    );
  return value;
}

function effectiveConfigEntry(
  key: RuntimeSettingKey,
  definition: ReturnType<typeof runtimeSettingDefinitions>[RuntimeSettingKey],
  row?: SettingRow,
) {
  const value = configValue(
    row === undefined ? definition.fallback : JSON.parse(row.value_json),
  );
  const source = row ? "database" : definition.environment ? "host" : "default";
  return { key, value, source, ...definition };
}

function requireOwnerToRaiseLimit(
  actor: AdminActor,
  previous: number,
  value: number,
): void {
  if (value > previous && actor.role !== "owner")
    throw new AppError(
      "OWNER_REQUIRED",
      "Only an owner can relax resource limits",
      403,
    );
}

export class AdminSystemService {
  constructor(private readonly deps: AdminDependencies) {}

  status() {
    const rendering = this.renderingHealth();
    return {
      writeEnabled: this.deps.writeEnabled,
      maintenance: this.deps.database.settings.value<MaintenanceMode>(
        "maintenance_mode",
        "normal",
      ),
      worker: rendering.mode,
      rendering,
      jobs: this.deps.database.jobs.statusCounts(),
      httpServices: this.deps.httpServices?.() ?? {
        managed: false,
        services: [],
      },
    };
  }
  config() {
    const items = this.deps.database.settings.listMutable();
    const definitions = runtimeSettingDefinitions(this.deps);
    return {
      items,
      effective: runtimeSettingKeys.map((key) =>
        effectiveConfigEntry(
          key,
          definitions[key],
          items.find((item) => item.key === key),
        ),
      ),
    };
  }
  audit(query: AuditLogQuery) {
    return this.deps.database.auditLogs.search(query);
  }
  ticketKeys() {
    return {
      activeKid: this.deps.activeTicketKid,
      verificationKids: this.deps.verificationTicketKids,
      minRevocationSeconds: ticketRevocationMinimumSeconds,
    };
  }
  renderingHealth() {
    const heartbeat = this.deps.database.settings.value<{
        workerId: string;
        at: string;
        stopping?: boolean;
      } | null>("worker_heartbeat", null),
      mode = this.deps.database.settings.value<string>(
        "worker_mode",
        "running",
      ),
      fresh =
        isWorkerHeartbeatFresh(heartbeat?.at) && heartbeat?.stopping !== true;
    const status = this.deps.workerStatus?.();
    return {
      operational: (status?.operational ?? fresh) && mode === "running",
      state: status?.state ?? (fresh ? mode : "unavailable"),
      mode,
      fresh,
      lastHeartbeatAt: heartbeat?.at ?? null,
    };
  }

  updateConfig(
    actor: AdminActor,
    input: {
      key: RuntimeSettingKey;
      value: number;
      reason: string;
    },
  ): void {
    const { minimum, maximum, fallback } = runtimeSettingDefinitions(this.deps)[
      input.key
    ];
    if (input.value < minimum || input.value > maximum)
      throw new AppError(
        "CONFIG_OUT_OF_RANGE",
        "Configuration value is outside its safe range",
        400,
      );
    this.deps.database.transaction(() => {
      const previous = configValue(
        this.deps.database.settings.value<unknown>(input.key, fallback),
      );
      requireOwnerToRaiseLimit(actor, previous, input.value);
      this.deps.database.settings.upsert(
        input.key,
        input.value,
        actor.id,
        nowIso(),
      );
      this.auditConfigChange(actor, "system.config_updated", input.key, {
        oldValue: previous,
        newValue: input.value,
        reason: input.reason,
      });
    });
  }

  resetConfig(
    actor: AdminActor,
    { key, reason }: { key: RuntimeSettingKey; reason: string },
  ) {
    const { database } = this.deps;
    const definition = runtimeSettingDefinitions(this.deps)[key];
    return database.transaction(() => {
      const previous = configValue(
        database.settings.value<unknown>(key, definition.fallback),
      );
      const entry = effectiveConfigEntry(key, definition);
      requireOwnerToRaiseLimit(actor, previous, entry.value);
      database.settings.delete(key);
      this.auditConfigChange(actor, "system.config.reset", key, {
        oldValue: previous,
        newValue: entry.value,
        reason,
      });
      return entry;
    });
  }

  private auditConfigChange(
    actor: AdminActor,
    action: "system.config_updated" | "system.config.reset",
    key: RuntimeSettingKey,
    metadata: { oldValue: number; newValue: number; reason: string },
  ): void {
    this.deps.database.audit({
      actorType: actor.type,
      actorId: actor.id,
      action,
      targetType: "system_setting",
      targetId: key,
      result: "success",
      metadata: { ...metadata, restartRequired: false },
    });
  }

  maintenance(
    actor: AdminActor,
    action: "enable" | "disable",
    mode: MaintenanceMode,
    reason?: string,
  ): MaintenanceMode {
    if (action === "enable" && (reason === undefined || reason.trim() === ""))
      throw new AppError(
        "MAINTENANCE_REASON_REQUIRED",
        "Maintenance reason is required",
        400,
      );
    const actual: MaintenanceMode = action === "disable" ? "normal" : mode;
    this.deps.database.transaction(() => {
      this.deps.database.settings.upsert(
        "maintenance_mode",
        actual,
        actor.id,
        nowIso(),
      );
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: `maintenance.${action}d`,
        targetType: "system",
        targetId: "maintenance",
        result: "success",
        metadata: {
          mode: actual,
          ...(reason === undefined ? {} : { reason: reason.trim() }),
        },
      });
    });
    return actual;
  }

  worker(actor: AdminActor, action: "pause" | "resume" | "drain"): string {
    const mode =
      action === "resume"
        ? "running"
        : action === "pause"
          ? "paused"
          : "draining";
    this.deps.database.transaction(() => {
      this.deps.database.settings.upsert(
        "worker_mode",
        mode,
        actor.id,
        nowIso(),
      );
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action:
          action === "pause"
            ? "worker.paused"
            : action === "resume"
              ? "worker.resumed"
              : "worker.drained",
        targetType: "system",
        targetId: "worker",
        result: "success",
      });
    });
    return mode;
  }

  revokeTicketKey(
    actor: AdminActor,
    kid: string,
    input: { reason: string; expiresAt: string },
  ): void {
    if (actor.role !== "owner")
      throw new AppError(
        "OWNER_REQUIRED",
        "Only an owner can revoke a ticket signing key",
        403,
      );
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(kid))
      throw new AppError("INVALID_KEY_ID", "Ticket key id is invalid", 400);
    if (kid === this.deps.activeTicketKid)
      throw new AppError(
        "ACTIVE_KEY_REVOCATION_FORBIDDEN",
        "Switch the active signing key before revoking the previous key",
        409,
      );
    if (!this.deps.verificationTicketKids.includes(kid))
      throw new AppError(
        "TICKET_KEY_NOT_CONFIGURED",
        "Ticket key is not configured as a verification key",
        404,
      );
    if (
      Date.parse(input.expiresAt) <
      Date.now() + ticketRevocationMinimumSeconds * 1000
    )
      throw new AppError(
        "INVALID_EXPIRY",
        "Revocation must cover the 30 minute ticket lifetime and 5 minute clock skew",
        400,
      );
    this.deps.database.transaction(() => {
      this.deps.database.security.revokeTicketKey(
        kid,
        input.reason,
        input.expiresAt,
        nowIso(),
      );
      this.deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "ticket_key.revoked",
        targetType: "ticket_key",
        targetId: kid,
        result: "success",
        metadata: { expiresAt: input.expiresAt },
      });
    });
  }
}
