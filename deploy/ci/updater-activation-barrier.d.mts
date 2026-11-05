export function activationBarrierControllerSource(paths: {
  socket: string;
  committed: string;
  timedOut: string;
  invalid: string;
}): string;
export function waitForControllerState(
  read: () => Promise<unknown>,
  options?: {
    now?: () => number;
    wait?: () => Promise<unknown>;
    timeoutMs?: number;
  },
): Promise<unknown>;
