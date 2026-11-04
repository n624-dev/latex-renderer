export interface LanHttpsSignerProcess {
  running(): boolean;
  certificate(): Promise<{ certificate: string; keyId: string }>;
  sign(keyId: string, digest: string): Promise<{ signature: string }>;
  close(): Promise<void>;
}
export function startLanHttpsSigner(options: {
  binary: string;
  bundleFile: string;
  stateDirectory: string;
  domain: string;
}): Promise<Readonly<LanHttpsSignerProcess>>;
