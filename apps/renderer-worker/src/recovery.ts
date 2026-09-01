import type { RendererDatabase } from "@latex-renderer/database";
import { nowIso } from "@latex-renderer/shared";
import type { WorkerConfig } from "./config.js";
import { dockerStopVerified, runDocker } from "./docker.js";

export async function recoverStaleLeases(
  database: RendererDatabase,
  config: WorkerConfig,
): Promise<void> {
  for (const job of database.worker.staleLeases(nowIso())) {
    const claimedAt = nowIso(),
      recoveryOwner = `${config.workerId}:recovery:${job.lease_generation + 1}`,
      recoveryGeneration = database.transaction(() =>
        database.worker.claimExpiredLease(
          job,
          recoveryOwner,
          claimedAt,
          new Date(Date.now() + 300_000).toISOString(),
        ),
      );
    if (recoveryGeneration === undefined) continue;

    let containerIds: string[];
    try {
      containerIds = (
        await runDocker([
          "ps",
          "-aq",
          "--filter",
          `label=latex-renderer.job=${job.id}`,
        ])
      )
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      if (!containerIds.every((id) => /^[a-f0-9]{12,64}$/.test(id)))
        throw new Error("Docker returned an invalid renderer container ID");
      for (const id of containerIds) await dockerStopVerified(id);
    } catch {
      database.transaction(() => {
        if (
          database.worker.expireRecoveryClaim(
            job.id,
            recoveryOwner,
            recoveryGeneration,
            nowIso(),
          ) !== 1
        )
          return;
        database.audit({
          actorType: "system",
          actorId: config.workerId,
          action: "render.lease_recovery_deferred",
          targetType: "job",
          targetId: job.id,
          result: "failed",
          metadata: { reason: "container_state_unavailable" },
        });
      });
      continue;
    }
    const exists = containerIds.length > 0;

    const timestamp = nowIso();
    database.transaction(() => {
      const changed = exists
        ? database.worker.recoverFailed(
            job.id,
            recoveryOwner,
            recoveryGeneration,
            timestamp,
          )
        : database.worker.recoverQueued(
            job.id,
            recoveryOwner,
            recoveryGeneration,
            timestamp,
          );
      if (changed !== 1) return;
      database.audit({
        actorType: "system",
        actorId: config.workerId,
        action: "render.lease_recovered",
        targetType: "job",
        targetId: job.id,
        result: exists ? "failed" : "success",
        metadata: {
          previousStatus: job.status,
          containerFound: exists,
          previousLeaseOwner: job.lease_owner,
          previousLeaseGeneration: job.lease_generation,
          recoveryLeaseGeneration: recoveryGeneration,
        },
      });
    });
  }
}
