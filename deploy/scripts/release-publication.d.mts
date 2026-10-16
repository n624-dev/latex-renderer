export function publishRelease(options: {
  source: string;
  releaseId: string;
  releasesRoot: string;
  journalRoot: string;
  uid?: number;
  gid?: number;
  copy?: (source: string, destination: string) => Promise<void>;
  checkpoint?: (
    phase: "journal-durable" | "copy-durable" | "published",
  ) => Promise<void>;
}): Promise<{ releaseId: string; reused: boolean }>;
export function collectReleasePublications(options: {
  releasesRoot: string;
  journalRoot: string;
  uid?: number;
  now?: number;
}): Promise<number>;
