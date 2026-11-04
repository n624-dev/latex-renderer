import type { LanHttpsAuthorityConfiguration } from "./configuration.mjs";
export function installLanHttpsOperatorCertificate(options: {
  config: LanHttpsAuthorityConfiguration;
  certificateFile: string;
  keyFile: string;
  trustedCertificates?: readonly string[];
  writeBytes?: typeof import("node:fs").writeSync;
}): Promise<Readonly<{ fingerprint256: string; expiresAt: string }>>;
