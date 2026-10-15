export const UPDATE_WAIT_MAX_MS = 90 * 60 * 1000;
export const UPDATE_RECONNECT_MAX_MS = 10 * 60 * 1000;

export class UpdateOperationUnconfirmedError extends Error {
  constructor(readonly operationId: string | null) {
    super(
      operationId === null
        ? "Update result is unconfirmed; the server did not return an operation ID. Do not apply again. Check: update status"
        : `Update result is unconfirmed; the server may still be running operation ${operationId}. Do not apply again. Resume with: update operation ${operationId}`,
    );
  }
}

interface Polling {
  read: (id: string, timeoutMs: number) => Promise<unknown>;
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
  if (typeof value.id !== "string")
    throw new UpdateOperationUnconfirmedError(null);
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
      current = await options.read(
        id,
        Math.min(30_000, UPDATE_WAIT_MAX_MS - (options.now() - started)),
      );
      lastContact = options.now();
    } catch {
      if (options.now() - lastContact >= UPDATE_RECONNECT_MAX_MS)
        throw new UpdateOperationUnconfirmedError(id);
      status("reconnecting to Admin API...");
      await options.sleep(1_500);
      continue;
    }
    const state = record(current);
    if (state.id !== id) throw new UpdateOperationUnconfirmedError(id);
    const next = typeof state.status === "string" ? state.status : "unknown";
    const outcome = record(state.outcome);
    const activating =
      next === "succeeded" &&
      outcome.application === "succeeded" &&
      outcome.updater === "activating" &&
      outcome.complete === false;
    const complete =
      outcome.complete === true &&
      outcome.application === "succeeded" &&
      (outcome.updater === "succeeded" || outcome.updater === "not-required");
    status(
      activating
        ? "application succeeded; Updater activating"
        : next === "succeeded" && !complete
          ? "application succeeded; Updater unconfirmed"
          : next,
    );
    if (next === "failed") return current;
    if (next === "succeeded" && !activating) {
      // Application success is not controller activation success. Old servers,
      // historical operations and failed/reverted activations cannot confirm
      // the whole update. Keep the original ID and never resubmit the mutation.
      if (!complete) throw new UpdateOperationUnconfirmedError(id);
      return current;
    }
    await options.sleep(1_500);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
