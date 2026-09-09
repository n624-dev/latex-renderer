export interface CiReleasePin {
  artifact: string;
  tag: string;
  commit: string;
  digest: string;
}
export function verifyCiReleaseArtifact(
  pin: CiReleasePin,
  verifyAttestation?: (args: string[]) => unknown,
): Promise<Omit<CiReleasePin, "artifact">>;
