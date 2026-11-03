export function probeFailureReason(error: unknown): string;
export function quiesceProbeAccount(options: {
  uid: number;
  workerUid: number;
  run: (file: string, args: string[]) => string;
  alive: (uid: number) => boolean;
  wait: (milliseconds: number) => Promise<unknown>;
}): Promise<void>;
