import type { ServerIngressReview } from "../../packages/server-setup-core/src/index.mjs";
import type { NetworkInterfaceInfo } from "node:os";
export function readSecureIngressFile(
  path: string,
  options: { uid: number; gid: number; mode: number; maximumBytes: number },
): Buffer;
export function verifyProductionIngressTls(
  review: ServerIngressReview | null,
  rendererGid: number,
): Readonly<{
  fingerprint256: string;
  expiresAt: string;
  publicOrigin: string;
}> | null;
export function verifyIngressInterface(
  review: ServerIngressReview | null,
  interfaces?: NodeJS.Dict<NetworkInterfaceInfo[]>,
): void;
export function checkIngressHttpsHealth(
  publicOrigin: string,
): Promise<Readonly<{ status: "ok"; publicOrigin: string }>>;
