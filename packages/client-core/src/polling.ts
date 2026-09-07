import type { JobResponse, SourceRenderResponse } from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import type { ClientTransport, RenderOptions } from "./index.js";

const terminalStatuses = new Set([
  "succeeded", "failed", "timeout", "canceled", "rejected", "deleted", "expired",
]);

/** Keep both the status request and any injected/custom transport bounded. */
export async function pollUntilTerminal(
  client: Pick<ClientTransport, "job" | "renewJobTicket">,
  ticket: SourceRenderResponse,
  options: RenderOptions,
): Promise<{ job: JobResponse; jobTicket: string }> {
  const interval = options.pollIntervalMs ?? 1000,
    timeout = options.pollTimeoutMs,
    now = options.now ?? Date.now,
    customSleep = options.sleep;
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0))
    throw new AppError("INVALID_POLL_TIMEOUT", "Poll timeout must be a positive integer", 400);
  if (!Number.isSafeInteger(interval) || interval < 0 || interval > 2_147_483_647)
    throw new AppError("INVALID_POLL_INTERVAL", "Poll interval must be a nonnegative integer", 400);
  const startedAt = now(), controller = new AbortController();
  const timeoutError = () => new AppError(
    "RENDER_POLL_TIMEOUT",
    "Render did not reach a terminal state before the local timeout",
    504,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const assertDeadline = () => {
    if (timeout !== undefined && now() - startedAt >= timeout)
      controller.abort(timeoutError());
    controller.signal.throwIfAborted();
  };
  const scheduleDeadline = () => {
    if (timeout === undefined) return;
    // Node timers clamp oversized delays to 1 ms; schedule long deadlines in
    // bounded slices rather than accidentally timing out immediately.
    timer = setTimeout(() => {
      const remaining = timeout - (now() - startedAt);
      if (remaining <= 0) controller.abort(timeoutError());
      else scheduleDeadline();
    }, Math.max(1, Math.min(timeout - (now() - startedAt), 2_147_483_647)));
  };
  let jobTicket = ticket.jobTicket, expiresAt = Date.parse(ticket.expiresAt);
  const renew = async () => {
    const renewed = await abortable(controller.signal, () =>
      client.renewJobTicket(ticket.jobId, { signal: controller.signal }),
    );
    jobTicket = renewed.jobTicket;
    expiresAt = Date.parse(renewed.expiresAt);
  };
  scheduleDeadline();
  try {
    for (;;) {
      assertDeadline();
      if (Number.isFinite(expiresAt) && expiresAt <= now() + 60_000) await renew();
      assertDeadline();
      let job: JobResponse;
      try {
        job = await abortable(controller.signal, () =>
          client.job(ticket.jobId, jobTicket, { signal: controller.signal }),
        );
      } catch (error) {
        // Do not turn revocation or a security-version change into a silent
        // authorization retry. Only an invalid/expired ticket is refreshed.
        if (!(error instanceof AppError) || error.code !== "INVALID_TICKET") throw error;
        assertDeadline();
        await renew();
        job = await abortable(controller.signal, () =>
          client.job(ticket.jobId, jobTicket, { signal: controller.signal }),
        );
      }
      assertDeadline();
      options.onEvent?.({ type: "job.status", jobId: ticket.jobId, status: job.status });
      if (terminalStatuses.has(job.status)) return { job, jobTicket };
      if (customSleep !== undefined) {
        await abortable(controller.signal, () => customSleep(interval));
      } else {
        await sleep(interval, controller.signal);
      }
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("Polling aborted");
}

async function abortable<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortReason(signal));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
