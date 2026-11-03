export function writeWorkerHealth(
  path: string,
  value: { at: string; mode: string; stopping: boolean },
): void;
export function readPassiveWorkerHealth(): Promise<{
  operational: boolean;
  state: string;
}>;
export function readWorkerHealth(options?: {
  path?: string;
  now?: number;
  databasePath?: string | undefined;
  run?: (...args: string[]) => string;
}): { operational: boolean; state: string };
