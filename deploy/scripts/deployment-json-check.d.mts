export interface DeploymentJsonDiagnostic {
  reason?: string;
  category?: string;
  code?: string;
  phase?: string;
  systemCode?: string;
  httpStatus?: number;
}
export function deploymentJsonDiagnostic(
  value: unknown,
): DeploymentJsonDiagnostic;
export function runDeploymentJsonCheck(
  command: string,
  args: string[],
  options?: {
    timeoutMs?: number;
    maxOutputBytes?: number;
    killGraceMs?: number;
  },
): Promise<{
  exitCode: number;
  output?: string;
  diagnostic?: DeploymentJsonDiagnostic;
}>;
