export interface WorkerDeployment {
  created_on: string;
  versions: Array<{ percentage: number; version_id: string }>;
}

export function activeWorkerVersion(deployments: WorkerDeployment[]): string;
