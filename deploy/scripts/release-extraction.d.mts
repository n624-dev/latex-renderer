export const releaseExtractor: "/usr/bin/bsdtar";
export function copyRootReleaseBundle(
  source: string,
  destination: string,
): Promise<void>;
export function assertReleaseExtractor(): Promise<void>;
export function prepareReleaseExtraction(
  bundle: string,
  directory: string,
): Promise<{ command: typeof releaseExtractor; args: string[] }>;
