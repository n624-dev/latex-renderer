export const RUNTIME_IDENTITY_VERSION: "runtime-v1";
export const RENDERER_RUNTIME_FILES: readonly string[];
export const RELEASE_RENDERER_FILES_V1: readonly string[];
export const RELEASE_RENDERER_FILES_V2: readonly string[];
export function legacyReleaseRendererFingerprint(rendererRoot: string): Promise<string>;
export function validatedReleaseRendererFingerprint(rendererRoot: string, manifest: {
  version: string;
  rendererRuntimeIdentity?: { schemaVersion: number; fingerprint: string } | null;
}): Promise<string>;
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
