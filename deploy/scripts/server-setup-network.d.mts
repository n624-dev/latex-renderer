import type { ServerIngressReview } from "../../packages/server-setup-core/src/index.mjs";
export function assertServerSetupSockets(
  output: string,
  ingress: ServerIngressReview,
  options?: {
    fresh?: boolean;
    requireInternal?: boolean;
    checkIngressPort?: boolean;
  },
): void;
