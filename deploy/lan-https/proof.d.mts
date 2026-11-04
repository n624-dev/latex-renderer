import type { KeyObject } from "node:crypto";
export interface LanHttpsIdentityPublicKey {
  readonly kty: "OKP";
  readonly crv: "Ed25519";
  readonly x: string;
}
export interface LanHttpsProof {
  readonly installationId: string;
  readonly nonce: string;
  readonly signature: string;
}
export interface LanHttpsProofInput {
  readonly audience: string;
  readonly nonce: string;
  readonly path: string;
  readonly body: Buffer;
}
export function lanHttpsPublicIdentity(input: unknown): Readonly<{
  installationId: string;
  publicKey: Readonly<LanHttpsIdentityPublicKey>;
}>;
export function lanHttpsBodyHash(body: Buffer): string;
export function createLanHttpsProof(
  privateKey: KeyObject | string | Buffer,
  input: LanHttpsProofInput,
): Readonly<LanHttpsProof>;
export function verifyLanHttpsProof(
  publicKey: unknown,
  proof: unknown,
  input: LanHttpsProofInput,
): ReturnType<typeof lanHttpsPublicIdentity>;
