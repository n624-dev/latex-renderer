import type {
  JobResponse,
  SourceRenderResponse,
} from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import type { ClientTransport, RenderOptions } from "./index.js";
import { abortable, createJobTicketAccess } from "./job-ticket-access.js";

const terminalStatuses = new Set([
  "succeeded",
  "failed",
  "timeout",
  "canceled",
  "rejected",
  "deleted",
  "expired",
]);

/** Keep both the status request and any injected/custom transport bounded. */
export async function pollUntilTerminal(
  client: Pick<ClientTransport, "job" | "renewJobTicket">,
  ticket: SourceRenderResponse,
  options: RenderOptions,
  ready?: (job: JobResponse) => boolean,
): Promise<{ job: JobResponse; jobTicket: string; ticketExpiresAt: string }> {
  const interval = options.pollIntervalMs ?? 1000,
    timeout = options.pollTimeoutMs,
    now = options.now ?? Date.now,
    customSleep = options.sleep;
  if (timeout !== undefined && (!Number.isSafeInteger(timeout) || timeout <= 0))
    throw new AppError(
      "INVALID_POLL_TIMEOUT",
      "Poll timeout must be a positive integer",
      400,
    );
  if (
    !Number.isSafeInteger(interval) ||
    interval < 0 ||
    interval > 2_147_483_647
  )
    throw new AppError(
      "INVALID_POLL_INTERVAL",
      "Poll interval must be a nonnegative integer",
      400,
    );
  const startedAt = now(),
    controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([controller.signal, options.signal])
    : controller.signal;
  let lastStatus: JobResponse["status"] | undefined;
  const timeoutError = () =>
    new AppError(
      "RENDER_POLL_TIMEOUT",
      "Local status-wait timeout. This client did not cancel the server Job; check its status or cancel it explicitly",
      504,
      { jobId: ticket.jobId, lastStatus: lastStatus ?? null },
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const assertDeadline = () => {
    if (timeout !== undefined && now() - startedAt >= timeout)
      controller.abort(timeoutError());
    signal.throwIfAborted();
  };
  const scheduleDeadline = () => {
    if (timeout === undefined) return;
    // Node timers clamp oversized delays to 1 ms; schedule long deadlines in
    // bounded slices rather than accidentally timing out immediately.
    timer = setTimeout(
      () => {
        const remaining = timeout - (now() - startedAt);
        if (remaining <= 0) controller.abort(timeoutError());
        else scheduleDeadline();
      },
      Math.max(1, Math.min(timeout - (now() - startedAt), 2_147_483_647)),
    );
  };
  const access = createJobTicketAccess(client, ticket, { now, signal });
  const wait = async (milliseconds: number) => {
    if (customSleep !== undefined)
      await abortable(signal, () => customSleep(milliseconds));
    else await sleep(milliseconds, signal);
  };
  const readStatus = async (jobTicket: string): Promise<JobResponse> => {
    // Only repeat the read-only status request, never job creation, upload,
    // ticket renewal or artifact verification. Bound retries even when the
    // caller supplies no overall polling deadline.
    for (let retries = 0; ; retries++) {
      assertDeadline();
      try {
        return await abortable(signal, () =>
          client.job(ticket.jobId, jobTicket, { signal }),
        );
      } catch (error) {
        assertDeadline();
        if (retries >= 5 || !isTransientStatusError(error)) throw error;
        await wait(Math.min(1000 * 2 ** retries, 8000));
      }
    }
  };
  scheduleDeadline();
  try {
    for (;;) {
      assertDeadline();
      const job = await access.read(readStatus);
      assertDeadline();
      lastStatus = job.status;
      options.onEvent?.({
        type: "job.status",
        jobId: ticket.jobId,
        status: job.status,
        ...(job.status === "queued" &&
        job.errorCode === "HOST_RESOURCE_WAIT" &&
        job.errorMessage
          ? { resourceWait: job.errorMessage }
          : {}),
      });
      if (terminalStatuses.has(job.status) || ready?.(job) === true)
        return { job, jobTicket: access.credential.jobTicket, ticketExpiresAt: access.credential.expiresAt };
      await wait(interval);
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function isTransientStatusError(error: unknown): boolean {
  return (
    error instanceof AppError &&
    (error.code === "HTTP_ERROR" || error.code === "INVALID_RESPONSE") &&
    [502, 503, 504].includes(error.status)
  );
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("Polling aborted");
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
