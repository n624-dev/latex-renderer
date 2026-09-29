import type { RecoveryStore, RecoveryPoint } from "./update-recovery.mjs";
export function withQuiescedRecovery<T>(
  options: {
    store: RecoveryStore;
    create: () => Promise<RecoveryPoint>;
    inspect?: (unit: string) => boolean;
    run?: (...args: string[]) => unknown;
    owner?: (
      pid?: number,
    ) => Promise<{ pid: number; start: string; boot: string }>;
    preflight?: () => Promise<void> | void;
  },
  action: (point: RecoveryPoint) => Promise<T>,
): Promise<T>;
export function withHostRecovery<T>(
  action: (point: RecoveryPoint | null) => Promise<T>,
  options?: { requireNormalMaintenance?: boolean },
): Promise<T>;
export function assertNormalMaintenanceForDeployment(
  databasePath?: string,
): Promise<void>;
