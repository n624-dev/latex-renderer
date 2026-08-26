export interface WorkerRoute {
  id: string;
  pattern: string;
  script?: string;
}

export interface WorkerRoutePlan {
  create: string[];
  remove: WorkerRoute[];
}

export function hostnameFromOrigin(origin: string): string;
export function desiredPublicWorkerPatterns(hostname: string): string[];
export function planPublicWorkerRoutes(
  routes: WorkerRoute[],
  options: { patterns: string[]; script: string; enabled?: boolean },
): WorkerRoutePlan;
