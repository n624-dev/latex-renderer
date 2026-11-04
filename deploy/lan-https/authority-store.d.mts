import type { DatabaseSync } from "node:sqlite";
import type { LanHttpsAuthorityPolicy } from "../../packages/server-setup-core/src/lan-https.mjs";
import type { LanHttpsProof } from "./proof.mjs";
import type {
  LanHttpsEabCredentials,
  LanHttpsExternalAccountBinding,
} from "./eab.mjs";
export class LanHttpsAuthorityError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number);
}
export function lanHttpsManagementHostname(
  installationId: string,
  domain: string,
): string;
export class LanHttpsAuthorityStore {
  constructor(options: {
    database: DatabaseSync;
    policy: unknown;
    now?: () => number;
  });
  readonly policy: LanHttpsAuthorityPolicy;
  counts(): Readonly<{
    installations: number;
    nonces: number;
    invites: number;
    challenges: number;
  }>;
  gc(): ReturnType<LanHttpsAuthorityStore["counts"]>;
  issueNonce(
    publicKey: unknown,
  ): Readonly<{ installationId: string; nonce: string; expiresAt: number }>;
  enroll(
    body: Buffer,
    proof: LanHttpsProof,
  ): Readonly<{ installationId: string; created: boolean }>;
  createInvite(options?: {
    uses?: number;
    ttlMs?: number;
  }): Readonly<{ code: string; expiresAt: number; uses: number }>;
  bindAcmeAccount(
    body: Buffer,
    proof: LanHttpsProof,
    issuer: (
      | LanHttpsEabCredentials
      | { newAccountUrl: string; kid: null; hmacKey: null }
    ) & { readonly id: string },
  ): Readonly<{
    issuer: string;
    externalAccountBinding: Readonly<LanHttpsExternalAccountBinding> | null;
  }>;
  presentChallenge(
    body: Buffer,
    proof: LanHttpsProof,
  ): Readonly<{ id: string; expiresAt: number }>;
  removeChallenge(
    body: Buffer,
    proof: LanHttpsProof,
  ): Readonly<{ removed: boolean }>;
  authorizeKeyless(
    body: Buffer,
    proof: LanHttpsProof,
    signing?: boolean,
  ): Readonly<{ hostname: string; keyId?: string; digest?: string }>;
  operatorChallenge(
    hostname: string,
    value: string,
    remove?: boolean,
  ): Readonly<{ removed?: boolean; name?: string; expiresAt?: number }>;
  challengeValues(name: string): readonly string[];
  revokeInstallation(id: string): void;
}
