import { createConnection } from "node:net";
import { Hono } from "hono";
import { AppError } from "@latex-renderer/shared";
import { requireOwnerActor } from "../auth/actor.js";
import type { AdminDependencies } from "../types.js";

function requestBackup(
  action: "status" | "create" | "verify",
): Promise<object> {
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
    socket.setTimeout(8000, failure);
    socket.once("error", failure);
    socket.once("connect", () => socket.write(`${action}\n`));
    socket.on("data", (chunk: string) => {
      response += chunk;
      if (response.length > 4096) return failure();
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
  return router;
}
