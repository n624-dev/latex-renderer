export const registryProbeImage: string;
export function dockerObjectMissing(
  error: unknown,
  kind: "image" | "container",
  target: string,
): boolean;
export function cleanupBaseIndexProbe(options: {
  run: (args: readonly string[], timeoutMs: number) => string;
  sleep?: (milliseconds: number) => Promise<unknown>;
  container: string | undefined;
  reference: string | undefined;
  imageIds: readonly string[];
  ownsRegistryImage: boolean;
}): Promise<void>;
