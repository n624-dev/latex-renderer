import type { LanHttpsAuthorityStore } from "./authority-store.mjs";
export function initializeLanHttpsAuthority(input: unknown): Readonly<{
  initialized: true;
  counts: ReturnType<LanHttpsAuthorityStore["counts"]>;
}>;
export function withLanHttpsAuthorityStore<T>(
  input: unknown,
  action: (store: LanHttpsAuthorityStore) => T,
): T;
export function startLanHttpsAuthority(
  input: unknown,
  options?: {
    allowEphemeral?: boolean;
    event?: (entry: Readonly<{ event: string }>) => void;
    signer?: unknown;
  },
): Promise<
  Readonly<{
    httpPort: number;
    dnsPorts: readonly number[];
    close(): Promise<void>;
  }>
>;
