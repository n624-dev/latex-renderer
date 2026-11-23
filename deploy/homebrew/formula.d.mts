export function clientReleaseUrl(version: string): string;
export function renderHomebrewFormula(
  version: string,
  sha256: string,
  options?: { fixture?: URL; revision?: number },
): string;
