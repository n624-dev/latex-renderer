import { createConnection } from "node:net";
import { Hono } from "hono";
import { z } from "zod";
import { adminMutationReasonSchema } from "@latex-renderer/contracts";
import { AppError, nowIso } from "@latex-renderer/shared";
import { requireOwnerActor } from "../auth/actor.js";
import type { AdminDependencies } from "../types.js";
import { parse, readJson } from "./helpers.js";

const policyKey = "backup_retention_policy";
const limits = z.strictObject({
  maxAgeDays: z.int().positive(),
  maxGenerations: z.int().positive(),
  maxTotalBytes: z.int().nonnegative(),
});
const confirmation = limits.extend({ reason: adminMutationReasonSchema });
const queryInteger = z.string().regex(/^\d+$/).transform(Number);
const proposal = z.strictObject({
  maxAgeDays: queryInteger.pipe(limits.shape.maxAgeDays),
  maxGenerations: queryInteger.pipe(limits.shape.maxGenerations),
  maxTotalBytes: queryInteger.pipe(limits.shape.maxTotalBytes),
});

function requestRetention(
  minFreeStorageBytes: number,
  proposedPolicy?: z.infer<typeof limits>,
) {
  const options = { minFreeStorageBytes, proposedPolicy };
  return requestBackup(`retention ${JSON.stringify(options)}`, true);
}

function requestBackup(action: string, retention = false): Promise<object> {
  return new Promise((resolve, reject) => {
    const socket = createConnection("/run/latex-renderer-backup-control.sock");
    const failure = () => {
      reject(
        new AppError(
          "BACKUP_CONTROL_UNAVAILABLE",
          "Backup operation is unavailable",
          503,
        ),
      );
      socket.destroy();
    };
    let response = "";
    socket.setEncoding("utf8");
    socket.setTimeout(retention ? 16000 : 8000, failure);
    socket.once("error", failure);
    socket.once("connect", () => socket.write(`${action}\n`));
    socket.on("data", (chunk: string) => {
      response += chunk;
      if (response.length > (retention ? 4 * 1024 * 1024 : 4096))
        return failure();
      if (!response.endsWith("\n")) return;
      try {
        const result: unknown = JSON.parse(response);
        if (typeof result !== "object" || result === null || "error" in result)
          return failure();
        resolve(result);
        socket.destroy();
      } catch {
        failure();
      }
    });
    socket.once("end", failure);
  });
}

export function createBackupsRouter(deps: AdminDependencies): Hono {
  const router = new Hono();
  router.get("/status", async (c) => {
    await requireOwnerActor(deps, c, "admin:system:read");
    return c.json(await requestBackup("status"));
  });
  for (const action of ["create", "verify"] as const) {
    router.post(`/${action}`, async (c) => {
      const actor = await requireOwnerActor(deps, c, "admin:system:write");
      const status = await requestBackup(action);
      deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: `backup.${action}_requested`,
        targetType: "system",
        targetId: "backup",
        result: "requested",
      });
      return c.json(status, 202);
    });
  }
  router.get("/retention", async (c) => {
    await requireOwnerActor(deps, c, "admin:system:read");
    const query = Object.entries(c.req.queries());
    const proposedPolicy =
      query.length === 0
        ? undefined
        : parse(
            proposal,
            Object.fromEntries(
              query.map(([key, values]) => [
                key,
                values.length === 1 ? values[0] : values,
              ]),
            ),
          );
    return c.json(
      await requestRetention(deps.minFreeStorageBytes, proposedPolicy),
    );
  });
  router.post("/retention", async (c) => {
    const actor = await requireOwnerActor(deps, c, "admin:system:write");
    const { reason, ...confirmedLimits } = parse(
      confirmation,
      await readJson(c),
    );
    const status = await requestRetention(deps.minFreeStorageBytes);
    if (!("archives" in status) || !Array.isArray(status.archives))
      throw new AppError(
        "BACKUP_CONTROL_UNAVAILABLE",
        "Backup operation is unavailable",
        503,
      );
    if (status.archives.length === 0)
      throw new AppError(
        "BACKUP_REQUIRED",
        "Create the first backup before confirming retention",
        409,
      );
    const policy = {
      ...confirmedLimits,
      confirmedAt: nowIso(),
      confirmedBy: actor.id,
    };
    deps.database.transaction(() => {
      deps.database.settings.upsert(
        policyKey,
        policy,
        actor.id,
        policy.confirmedAt,
      );
      deps.database.audit({
        actorType: actor.type,
        actorId: actor.id,
        action: "backup.retention.confirmed",
        targetType: "system_setting",
        targetId: policyKey,
        result: "success",
        metadata: { ...policy, reason },
      });
    });

    const prune = await requestBackup("prune", true).catch((error: unknown) => {
      if (
        !(error instanceof AppError) ||
        error.code !== "BACKUP_CONTROL_UNAVAILABLE"
      )
        throw error;
      return { status: "failed", warnings: [error.code] };
    });
    return c.json({ policy, prune });
  });
  return router;
}
