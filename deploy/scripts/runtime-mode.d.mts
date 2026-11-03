export function runtimeMode(
  environment?: NodeJS.ProcessEnv,
): "classic" | "compact";
export function managerIdleConfiguration(environment?: NodeJS.ProcessEnv): {
  enabled: boolean;
  timeoutMs: number;
};
export function runtimeEnvironment(contents: string): NodeJS.ProcessEnv;
