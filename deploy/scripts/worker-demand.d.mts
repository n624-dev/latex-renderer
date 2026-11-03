import type { DatabaseSync } from "node:sqlite";
export const WORKER_WAKE_PATH: string;
export function workerIdleConfiguration(environment?: NodeJS.ProcessEnv): {
  enabled: boolean;
  timeoutMs: number;
};
export function workerHasDemand(database: DatabaseSync): boolean;
export function notifyWorker(options?: {
  path?: string;
  timeoutMs?: number;
}): Promise<boolean>;
export function notifyWorkerAfterCommit(
  database: DatabaseSync,
  environment?: NodeJS.ProcessEnv,
): void;
export function workerWakeListener(
  environment?: NodeJS.ProcessEnv,
  options?: { path?: string },
): Promise<{ close(): Promise<void> } | undefined>;
