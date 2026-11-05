export const ENGINE_LOCK_PATH: string;
export function acquireEngineLock(options?: {
  path?: string;
  exclusive?: boolean;
}): Promise<{ release(): Promise<void> }>;
export function workerEngineCommand(command: string, args: string[]): string;
export function withContainerEngine<T>(
  operation: () => T | Promise<T>,
  environment?: NodeJS.ProcessEnv,
): Promise<T>;
export function withScopedContainerEngine<T>(
  operation: () => T | Promise<T>,
  environment?: NodeJS.ProcessEnv,
  options?: { prepare?: () => Promise<{ release(): Promise<void> }> },
): Promise<T>;
