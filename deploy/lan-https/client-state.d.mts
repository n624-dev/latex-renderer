import type { writeSync } from "node:fs";
export function withLanHttpsClientLock<T>(
  root: string,
  action: (state: LanHttpsClientState) => Promise<T>,
): Promise<T>;
export class LanHttpsClientState {
  constructor(root: string, options?: { writeBytes?: typeof writeSync });
  read(name: string, maximumBytes?: number): Buffer | null;
  ensureKeys(): Readonly<{
    identityKey: Buffer;
    accountKey: Buffer;
    tlsKey: Buffer;
  }>;
  recoverTemporaryFiles(): Readonly<{ removed: number }>;
  readAccounts(): Readonly<
    Record<string, Readonly<{ directoryUrl: string; accountUrl: string }>>
  >;
  saveAccount(id: string, directoryUrl: string, accountUrl: string): void;
  saveProtocolRecord(name: "order.json" | "renewal.json", value: unknown): void;
  installCertificate(
    certificate: string,
    options: {
      hostnames: readonly string[];
      now?: number;
      trustedCertificates?: readonly string[];
    },
  ): Promise<Readonly<{ fingerprint256: string; expiresAt: string }>>;
}
