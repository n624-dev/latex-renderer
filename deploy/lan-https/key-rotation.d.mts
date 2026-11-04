import type { Client } from "acme-client";
import type { LanHttpsClientConfiguration } from "./configuration.mjs";
export function rotateLanHttpsAccountKeys(
  config: LanHttpsClientConfiguration,
  options?: {
    clientFactory?: (options: {
      directoryUrl: string;
      accountUrl: string;
      accountKey: Buffer;
    }) => Promise<Pick<Client, "updateAccount" | "updateAccountKey">>;
  },
): Promise<Readonly<{ rotated: true; accounts: number }>>;
