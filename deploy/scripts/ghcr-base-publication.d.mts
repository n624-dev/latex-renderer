export type Architecture = "amd64" | "arm64";
export interface Descriptor {
  mediaType: string;
  digest: string;
  size: number;
  platform?: { os: string; architecture: string; variant?: string };
}
export interface Manifest {
  schemaVersion: number;
  mediaType: string;
  manifests?: Descriptor[];
  config?: { digest: string };
}
export interface ImageConfig {
  os: string;
  architecture: string;
  config: { Labels?: Record<string, string> };
}
export interface Identity {
  date: string;
  installer: string;
  canonical: string;
  commit: string;
  runId: string;
  attempt: string;
}
export interface Receipt extends Identity {
  schema: number;
  validated: boolean;
  architecture: Architecture;
  imageId: string;
  manifest: Descriptor;
}
export interface Registry {
  manifest(reference: string): Promise<{
    manifest: Manifest;
    digest: string;
    bytes: string;
    size: number;
  } | null>;
  config(digest: string): Promise<ImageConfig>;
  put(tag: string, bytes: string): Promise<void>;
}
export const baseRepository: string;
export function basePlatforms(
  manifest: unknown,
): Record<Architecture, Descriptor>;
export function registryClient(options?: {
  fetchImpl?: typeof fetch;
  actor?: string;
  token?: string;
}): Registry;
export function planBase(
  date: string,
  registry?: Registry,
): Promise<{
  mode: "create" | "reuse" | "legacy";
  digest: string;
  architectures: Architecture[];
  manifests: Partial<Record<Architecture, Descriptor>>;
}>;
export function verifyBaseConfig(
  config: ImageConfig,
  arch: string,
  expected: Pick<Identity, "canonical" | "installer">,
): void;
export function publicationIndex(records: unknown, expected: Identity): string;
export function publishBase(
  records: Receipt[],
  expected: Identity,
  registry?: Registry,
): Promise<string>;
export function stageBase(
  base: string,
  arch: Architecture,
  expected: Identity,
  existingDigest: string,
  publish: boolean,
  registry: Registry,
  options?: {
    run?: (
      program: string,
      args: string[],
      options?: Record<string, unknown>,
    ) => string;
    temporaryRoot?: string;
    space?: (path: string) => Promise<{ bavail: number; bsize: number }>;
  },
): Promise<Receipt>;
export function nativeBaseDigest(
  arch: Architecture,
  registry?: Registry,
): Promise<string>;
