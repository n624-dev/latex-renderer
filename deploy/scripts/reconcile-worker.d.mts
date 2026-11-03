import type { DatabaseSync } from "node:sqlite";
export function workerMaintenanceDue(
  database: DatabaseSync,
  now?: number,
): boolean;
export function reconcileWorker(options?: {
  environment?: NodeJS.ProcessEnv;
  run?: (...args: string[]) => string;
  notify?: () => Promise<boolean>;
}): Promise<{ state: string; demand?: boolean; maintenance?: boolean }>;
