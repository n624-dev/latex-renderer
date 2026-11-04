import type { writeSync } from "node:fs";
export function withLanHttpsClientLock<T>(
  root: string,
  action: (state: LanHttpsClientState) => Promise<T>,
  options?: { lockFile?: "client.lock" | "operator.lock" | "serve.lock" },
): Promise<T>;
export class LanHttpsClientState {
  constructor(
    root: string,
    options?: {
      writeBytes?: typeof writeSync;
      initialKeys?: Readonly<Record<string, Buffer | string>>;
    },
  );
  read(name: string, maximumBytes?: number): Buffer | null;
  ensureIdentityKey(): Buffer;
  ensureAccountKey(): Buffer;
  prepareTlsRotation(): Buffer;
  recoverTlsRotation(): void;
  prepareAccountRotation(): Buffer;
  commitAccountRotation(): void;
  synchronizeAccountRotation(previous: Buffer | null, next: Buffer): void;
  finishAccountRotation(): void;
  ensureKeys(): Readonly<{
    identityKey: Buffer;
    accountKey: Buffer;
    tlsKey: Buffer;
  }>;
  saveInvitation(code: string): void;
  recoverTemporaryFiles(): Readonly<{ removed: number }>;
  readAccounts(): Readonly<
    Record<string, Readonly<{ directoryUrl: string; accountUrl: string }>>
  >;
  saveAccount(id: string, directoryUrl: string, accountUrl: string): void;
  saveProtocolRecord(
    name:
      "order.json" | "renewal.json" | "profiles.json" | "account-rotation.json",
    value: unknown,
  ): void;
  installCertificate(
    certificate: string,
    options: {
      hostnames: readonly string[];
      now?: number;
      trustedCertificates?: readonly string[];
      privateKey?: Buffer | string;
    },
  ): Promise<Readonly<{ fingerprint256: string; expiresAt: string }>>;
}
