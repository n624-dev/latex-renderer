export function brokenUpdaterSource(markerPath: string, nonce: string): string;
export function assertStartupRecovery(input: {
  failure: { status: number; stderr: unknown } | null;
  marker: { nonce: string; cwd: string } | null;
  nonce: string;
  brokenRoot: string;
  state: {
    current: string;
    previous: string | null;
    candidate: string | null;
    pending: unknown;
  };
  before: { current: string; previous: string | null };
}): void;
