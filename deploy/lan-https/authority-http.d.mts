import type { RequestListener } from "node:http";
import type { LanHttpsAuthorityStore } from "./authority-store.mjs";
import type { LanHttpsEabCredentials } from "./eab.mjs";
import type { LanHttpsRateLimit } from "./rate-limit.mjs";
export function createLanHttpsAuthorityHandler(options: {
  store: LanHttpsAuthorityStore;
  issuers?: readonly (LanHttpsEabCredentials & {
    readonly id: string;
    readonly directoryUrl: string;
  })[];
  trustLoopbackProxy?: boolean;
  requestLimit?: Readonly<LanHttpsRateLimit>;
  registrationLimit?: Readonly<LanHttpsRateLimit>;
  maxConcurrentRequests?: number;
}): RequestListener;
