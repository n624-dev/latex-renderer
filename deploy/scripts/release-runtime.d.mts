export function pruneRuntimeDependencies(root: string): Promise<{
  enabled: boolean;
  selectedPackages: number;
  removedPackages: number;
}>;
