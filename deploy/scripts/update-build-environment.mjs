// Apply these bounds to individual update build steps. In particular, the
// install heap setting must never leak into compilation or running services.
export function updateBuildEnvironment(environment, command) {
  if (command === "install")
    return {
      ...environment,
      PNPM_MAX_WORKERS: "1",
      PNPM_CONFIG_NETWORK_CONCURRENCY: "4",
      PNPM_CONFIG_CHILD_CONCURRENCY: "1",
      NODE_OPTIONS: `${environment.NODE_OPTIONS ? `${environment.NODE_OPTIONS} ` : ""}--max-old-space-size=256`,
    };
  if (command === "build:production-services")
    return { ...environment, PNPM_CONFIG_WORKSPACE_CONCURRENCY: "1" };
  return { ...environment };
}
