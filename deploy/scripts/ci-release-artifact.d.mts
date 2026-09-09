export interface CiReleasePin {
  artifact: string;
  tag: string;
  commit: string;
  digest: string;
  attestationBundle?: string;
}
export function verifyCiReleaseArtifact(
  pin: CiReleasePin,
  verifyAttestation?: (args: string[]) => unknown,
): Promise<Omit<CiReleasePin, "artifact" | "attestationBundle">>;
export function verifyCiValidationArtifact(
  pin: CiReleasePin & { sourceRef: string },
  verifyAttestation?: (args: string[]) => unknown,
): Promise<Omit<CiReleasePin, "artifact" | "attestationBundle">>;
export function validationAttestationArgs(pin: {
  artifact: string;
  tag: string;
  commit: string;
  bundle?: string;
  sourceRef: string;
}): string[];
