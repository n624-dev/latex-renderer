export const UPDATE_WAIT_MAX_MS = 90 * 60 * 1000;
export const UPDATE_RECONNECT_MAX_MS = 10 * 60 * 1000;

export class UpdateOperationUnconfirmedError extends Error {
  constructor(readonly operationId: string) {
    super(
      `Update result is unconfirmed; the server may still be running operation ${operationId}. Do not apply again. Resume with: update operation ${operationId}`,
    );
  }
}

interface Polling {
  read: (id: string) => Promise<unknown>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  onStatus: (status: string) => void;
  onOperation: (id: string) => void;
}

// Only GET the operation originally returned by the mutation. A restart or
// timeout cannot issue another apply, assume failure or change the version.
export async function pollUpdateOperation(
  initial: unknown,
  options: Polling,
): Promise<unknown> {
  const value = record(initial);
  if (typeof value.id !== "string") return initial;
  const id = value.id;
  if (!/^updop_[A-Za-z0-9_]{1,100}$/.test(id))
    throw new Error("Invalid update operation ID");
  options.onOperation(id);
  const started = options.now();
  let lastContact = started;
  let lastStatus = "";
  const status = (next: string) => {
    if (next === lastStatus) return;
    lastStatus = next;
    options.onStatus(next);
  };
  for (;;) {
    if (options.now() - started >= UPDATE_WAIT_MAX_MS)
      throw new UpdateOperationUnconfirmedError(id);
    let current: unknown;
    try {
      current = await options.read(id);
      lastContact = options.now();
    } catch {
      if (options.now() - lastContact >= UPDATE_RECONNECT_MAX_MS)
        throw new UpdateOperationUnconfirmedError(id);
      status("reconnecting to Admin API...");
      await options.sleep(1_500);
      continue;
    }
    const state = record(current);
    const next = typeof state.status === "string" ? state.status : "unknown";
    status(next);
    if (next === "succeeded" || next === "failed") return current;
    await options.sleep(1_500);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
