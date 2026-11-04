export interface LanHttpsAcmePublicKey {
  readonly kty: "EC";
  readonly crv: "P-256";
  readonly x: string;
  readonly y: string;
}
export interface LanHttpsEabCredentials {
  readonly newAccountUrl: string;
  readonly kid: string;
  readonly hmacKey: string;
}
export interface LanHttpsExternalAccountBinding {
  readonly protected: string;
  readonly payload: string;
  readonly signature: string;
}
export function canonicalLanHttpsAcmePublicKey(
  input: unknown,
): Readonly<LanHttpsAcmePublicKey>;
export function lanHttpsAcmeAccountId(publicKey: unknown): string;
export function createLanHttpsExternalAccountBinding(
  publicKey: unknown,
  credentials: LanHttpsEabCredentials,
): Readonly<LanHttpsExternalAccountBinding>;
