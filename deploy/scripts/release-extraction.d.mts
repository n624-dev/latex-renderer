export const releaseExtractor: "/usr/bin/bsdtar";
export function assertReleaseExtractor(): Promise<void>;
export function prepareReleaseExtraction(
  bundle: string,
  directory: string,
): Promise<{ command: typeof releaseExtractor; args: string[] }>;
