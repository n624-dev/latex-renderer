export interface ParsedReleaseVersion {
  value: string;
  major: number;
  minor: number;
  patch: number;
  candidate: number | null;
  prerelease: boolean;
}

export function parseReleaseVersion(value: unknown): ParsedReleaseVersion;
export function validReleaseVersion(value: unknown): string;
export function validStableVersion(value: unknown): string;
export function isReleaseCandidate(value: unknown): boolean;
export function assertValidatedCandidateTag(
  value: unknown,
  releaseVersion: unknown,
): void;
export function compareReleaseVersions(left: unknown, right: unknown): number;
