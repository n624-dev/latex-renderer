import { AppError } from "@latex-renderer/shared";

export async function withClientOperationDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal | undefined; timeoutMs?: number } = {},
): Promise<T> {
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const timer = setTimeout(
    () =>
      controller.abort(
        new AppError(
          "CLIENT_OPERATION_TIMEOUT",
          "The local operation timed out. Check the status of any accepted Job before submitting again.",
          504,
        ),
      ),
    options.timeoutMs ?? 30 * 60_000,
  );
  timer.unref();
  try {
    signal.throwIfAborted();
    return await operation(signal);
  } catch (error) {
    if (signal.aborted && !(error instanceof AppError))
      signal.throwIfAborted();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
