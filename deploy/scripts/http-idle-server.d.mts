import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
export function httpIdleConfiguration(environment?: NodeJS.ProcessEnv): {
  enabled: boolean;
  timeoutMs: number;
};
export function activationDescriptor(
  environment?: NodeJS.ProcessEnv,
  pid?: number,
): number | undefined;
export function startHttpService(
  server: unknown,
  options: {
    port: number;
    name: string;
    environment?: NodeJS.ProcessEnv;
    onListening?: (info: AddressInfo) => void;
    onIdle?: () => void | Promise<void>;
    busyUntil?: () => number;
    now?: () => number;
    configuration?: { enabled: boolean; timeoutMs: number };
  },
): Server;
