import { Hono } from "hono";
import { z } from "zod";
import { AppError } from "@latex-renderer/shared";
import { requireActor } from "../auth/actor.js";
import type { AdminActor, AdminDependencies } from "../types.js";
import { parse } from "./helpers.js";

const versionSchema = z.string().regex(/^v?\d+\.\d+\.\d+$/);
const requestSchema = z.object({ version: versionSchema.optional() });
const policySchema = z.object({ channel: z.literal("stable").default("stable"), mode: z.enum(["notify", "automatic"]) });
type OperationResponse = { id?: string };

export function createUpdatesRouter(deps: AdminDependencies): Hono {
  const router = new Hono();
  const manager = () => {
    if (!deps.updateManager) throw new AppError("UPDATE_MANAGER_UNAVAILABLE", "Application Update Manager is not configured", 503);
    return deps.updateManager;
  };
  router.get("/state", async (context) => {
    await requireActor(deps, context, "admin:system:read");
    return context.json(await manager().state());
  });
  router.get("/operations/:id", async (context) => {
    await requireActor(deps, context, "admin:system:read");
    return context.json(await manager().operation(context.req.param("id")));
  });
  router.post("/check", async (context) => {
    const actor = await requireActor(deps, context, "admin:system:write");
    const input = parse(requestSchema, await context.req.json<unknown>());
    const result = await manager().check(input.version);
    audit(deps, actor, "application_update.checked", input.version ?? "stable", "success");
    return context.json(result);
  });
  router.post("/policy", async (context) => {
    const actor = await requireActor(deps, context, "admin:system:write");
    const input = parse(policySchema, await context.req.json<unknown>());
    const result = await manager().policy(input.mode);
    audit(deps, actor, "application_update.policy_updated", `${input.channel}:${input.mode}`, "success");
    return context.json(result);
  });
  router.post("/refresh", async (context) => {
    const actor = await requireActor(deps, context, "admin:system:write");
    const result = await manager().refresh();
    audit(deps, actor, "application_update.refresh_requested", "stable", "requested");
    return context.json(result);
  });
  router.post("/apply", async (context) => {
    const actor = await requireActor(deps, context, "admin:system:write");
    const input = parse(requestSchema, await context.req.json<unknown>());
    const result = (await manager().apply(input.version)) as OperationResponse;
    audit(deps, actor, "application_update.apply_requested", result.id ?? input.version ?? "stable", "requested");
    return context.json(result, 202);
  });
  router.post("/rollback", async (context) => {
    const actor = await requireActor(deps, context, "admin:system:write");
    const result = (await manager().rollback()) as OperationResponse;
    audit(deps, actor, "application_update.rollback_requested", result.id ?? "rollback", "requested");
    return context.json(result, 202);
  });
  return router;
}

function audit(
  deps: AdminDependencies,
  actor: AdminActor,
  action: string,
  targetId: string,
  result: "success" | "requested",
): void {
  deps.database.audit({ actorType: actor.type, actorId: actor.id, action, targetType: "application_update", targetId, result, metadata: {} });
}
