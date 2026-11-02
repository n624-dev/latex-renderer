export function writeWorkerHealth(
  path: string,
  value: { at: string; mode: string; stopping: boolean },
): void;
export function readWorkerHealth(options?: {
  path?: string;
  now?: number;
  run?: (...args: string[]) => string;
}): { operational: boolean; state: string };
