export function isHostRuntimeGeneration(name: unknown): boolean;
export function stageHostRuntime(options: {
  root: string;
  library: string;
  nodeVersion: string;
  corepackVersion: string;
  owner?: number;
  verify?: (paths: {
    node: string;
    corepack: string;
    nodeVersion: string;
    corepackVersion: string;
  }) => void | Promise<void>;
}): Promise<string>;
export function replaceHostRuntimeLink(path: string, target: string): Promise<void>;
export function recordHostRuntimeResult(root: string, value: {
  status: "applied" | "rolled-back";
  checkedAt: string;
}): Promise<void>;
