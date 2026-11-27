import type { SourceRenderResponse } from "@latex-renderer/contracts";
import { AppError } from "@latex-renderer/shared";
import type { ClientTransport } from "./index.js";

export function createJobTicketAccess(
  client: Pick<ClientTransport, "renewJobTicket">,
  issued: Pick<SourceRenderResponse, "jobId" | "jobTicket" | "expiresAt">,
  {
    now = Date.now,
    signal,
  }: {
    now?: (() => number) | undefined;
    signal?: AbortSignal | undefined;
  } = {},
) {
  let credential = issued;
  const renew = async () => {
    const next = await abortable(signal, () =>
      client.renewJobTicket(issued.jobId, { signal }),
    );
    credential = { jobId: issued.jobId, ...next };
  };
  return {
    get credential() {
      return credential;
    },
    signal,
    async read<T>(operation: (ticket: string) => Promise<T>): Promise<T> {
      const expiresAt = Date.parse(credential.expiresAt);
      if (Number.isFinite(expiresAt) && expiresAt <= now() + 60_000)
        await renew();
      try {
        signal?.throwIfAborted();
        return await operation(credential.jobTicket);
      } catch (error) {
        // Revoked credentials and stale security versions require an explicit
        // operator action. Only repeat a read with an invalid/expired ticket.
        if (!(error instanceof AppError) || error.code !== "INVALID_TICKET")
          throw error;
        await renew();
        signal?.throwIfAborted();
        return operation(credential.jobTicket);
      }
    },
  };
}

export type JobTicketAccess = ReturnType<typeof createJobTicketAccess>;

export async function abortable<T>(
  signal: AbortSignal | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!signal) return operation();
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      const reason: unknown = signal.reason;
      reject(reason instanceof Error ? reason : new Error("Client operation aborted", { cause: reason }));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}
