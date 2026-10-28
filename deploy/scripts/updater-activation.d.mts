export function controllerIdle(state: unknown): boolean;
export function activateAfterOperation(options: {
  acquireLock: () => Promise<{ release: () => Promise<void> }>;
  hasCandidate: () => Promise<boolean>;
  verifyCandidate?: () => Promise<unknown>;
  readController: () => Promise<unknown>;
  stopController: () => Promise<unknown>;
  recover: () => Promise<unknown>;
  startController: () => Promise<unknown>;
  activate: () => Promise<unknown>;
  wait?: () => Promise<unknown>;
  now?: () => number;
  timeoutMs?: number;
}): Promise<boolean>;
