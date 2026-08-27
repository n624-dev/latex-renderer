export const RUNTIME_IDENTITY_VERSION: "runtime-v1";
export const RENDERER_RUNTIME_FILES: readonly string[];
export function normalizeRuntimeLanguages(values: readonly unknown[]): string[];
export function rendererRuntimeFingerprint(rendererRoot: string): Promise<string>;
export function runtimeIdentity(input: {
  baseImageId: string;
  rendererFingerprint: string;
  languages: readonly unknown[];
  snapshotDate?: string | null;
}): {
  version: "runtime-v1";
  digest: string;
  tag: string;
  baseImageId: string;
  rendererFingerprint: string;
  languages: string[];
  snapshotDate: string | null;
};
