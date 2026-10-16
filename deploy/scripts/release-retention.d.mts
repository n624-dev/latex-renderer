interface Options {
  releasesRoot: string;
  currentLink: string;
  statePath: string;
  uid?: number;
  now?: number;
}
export function captureReleaseRetention(options: Options): Promise<{
  format: number;
  previous: string | null;
  successful: { id: string; verifiedAt: number }[];
}>;
export function collectReleases(
  options: Options & {
    releaseId: string;
    protectedIds?: string[];
    mountPaths?: string[];
    markVerified?: boolean;
    checkpoint?: (
      phase: "deletion-recorded" | "trashed" | "deleted",
    ) => Promise<void>;
  },
): Promise<{ removed: number; retained: string[] }>;
export function collectHostReleaseArtifacts(
  releaseId?: string | null,
): Promise<unknown>;
export function collectHelperStages(options: {
  root: string;
  uid?: number;
  mountPaths?: string[];
}): Promise<number>;
