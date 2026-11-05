import type { Order } from "acme-client";
import type { LanHttpsClientState } from "./client-state.mjs";
export function checkedLanHttpsOrder(
  order: unknown,
  hostnames: readonly string[],
  accountUrl: string,
): Order;
export function normalizeLanHttpsOrder(
  order: unknown,
  hostnames: readonly string[],
  accountUrl: string,
): Order;
export interface LanHttpsIssuanceJournal {
  load(): { order: Order; csr: Buffer } | null;
  save(order: Order, csr: Buffer): void;
  clear(): void;
}
export class LanHttpsOrderJournal implements LanHttpsIssuanceJournal {
  constructor(options: {
    state: LanHttpsClientState;
    provider: unknown;
    installationId: string;
    issuerId: string;
    directoryUrl: string;
    accountUrl: string;
    accountKey: Buffer | string;
    tlsKey: Buffer | string;
  });
  load(): { order: Order; csr: Buffer } | null;
  save(order: Order, csr: Buffer): void;
  clear(): void;
}
