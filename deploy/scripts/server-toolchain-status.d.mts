export function serverToolchainStatus(options?: {
  nodePath?: string;
  nodeVersion?: string;
  corepackPath?: string;
  aptManifestPath?: string;
  managedRoot?: string;
  owner?: number;
}): Promise<{
  node: {
    version: string;
    source: "managed-copy" | "host" | "unknown";
    compatible: boolean;
    supportedMajors: readonly number[];
  };
  corepack: {
    version: string | null;
    source: "managed-copy" | "host" | "unknown";
  };
  apt?: {
    nodeVersion: string;
    corepackVersion: string;
    status: "available" | "current" | "incompatible";
  };
}>;
