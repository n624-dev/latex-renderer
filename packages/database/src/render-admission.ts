import { AppError } from "@latex-renderer/shared";
import type { RendererDatabase } from "./index.js";
import { defaultMaxUserActiveJobs } from "./runtime-settings.js";

type AdmissionDatabase = Pick<RendererDatabase, "jobs" | "settings">;

export function assertRenderAvailable(
  db: Pick<RendererDatabase, "settings">,
): void {
  if (db.settings.value<string>("maintenance_mode", "normal") !== "normal")
    throw new AppError(
      "MAINTENANCE",
      "New jobs are temporarily unavailable",
      503,
    );
}

export function assertUserStorageQuota(
  db: AdmissionDatabase,
  userId: string,
  maxUserStorageBytes: number,
  requestedBytes: number,
): void {
  const maximum = db.settings.value(
    "max_user_storage_bytes",
    maxUserStorageBytes,
  );
  const used = db.jobs.storageUsageForUser(userId);
  if (requestedBytes > maximum - used)
    throw new AppError(
      "USER_STORAGE_QUOTA",
      "User storage quota is exhausted",
      429,
    );
}

// Keep the final check and the reservation in the same database transaction.
// The caller supplies the storage delta for this request (including output).
export function assertRenderAdmission(
  db: AdmissionDatabase,
  { userId, serviceAccountId }: { userId: string; serviceAccountId: string },
  limits: { maxQueueLength: number; maxUserStorageBytes: number },
  requestedBytes: number,
): void {
  assertRenderAvailable(db);
  if (
    db.jobs.countActive() >=
    db.settings.value("max_queue_length", limits.maxQueueLength)
  )
    throw new AppError("QUEUE_FULL", "Render queue is full", 503);
  if (db.jobs.countActiveForServiceAccount(serviceAccountId) >= 5)
    throw new AppError(
      "ACCOUNT_QUEUE_LIMIT",
      "Service account pending job limit reached",
      429,
    );
  if (
    db.jobs.countActiveForUser(userId) >=
    db.settings.value("max_user_active_jobs", defaultMaxUserActiveJobs)
  )
    throw new AppError(
      "USER_QUEUE_LIMIT",
      "User pending job limit reached",
      429,
    );
  assertUserStorageQuota(
    db,
    userId,
    limits.maxUserStorageBytes,
    requestedBytes,
  );
}
