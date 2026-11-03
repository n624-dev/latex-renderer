export function idleContainerEngine(options?: {
  environment?: NodeJS.ProcessEnv;
  acquireMutation?: () => Promise<{ release(): Promise<void> }>;
  acquireEngine?: () => Promise<{ release(): Promise<void> }>;
  command?: (command: string, args: string[]) => string;
  service?: (unit: string) => string;
}): Promise<{ state: string; stopped?: boolean }>;
