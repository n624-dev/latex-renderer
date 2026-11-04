import type { RequestListener } from "node:http";
import type { LanHttpsAuthorityStore } from "./authority-store.mjs";
import type { LanHttpsEabCredentials } from "./eab.mjs";
import type { LanHttpsRateLimit } from "./rate-limit.mjs";
export function createLanHttpsAuthorityHandler(options: {
  store: LanHttpsAuthorityStore;
  issuers?: readonly ((
    LanHttpsEabCredentials | { newAccountUrl: string; kid: null; hmacKey: null }
  ) & {
    readonly id: string;
    readonly directoryUrl: string;
  })[];
  signer?: {
    certificate(): Promise<{ certificate: string; keyId: string }>;
    sign(keyId: string, digest: string): Promise<{ signature: string }>;
  };
  signingLimit?: Readonly<LanHttpsRateLimit>;
  trustLoopbackProxy?: boolean;
  requestLimit?: Readonly<LanHttpsRateLimit>;
  registrationLimit?: Readonly<LanHttpsRateLimit>;
  maxConcurrentRequests?: number;
}): RequestListener;
