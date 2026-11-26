import { randomUUID } from "node:crypto";

type Failure =
  | "busy"
  | "operation_failed"
  | "disconnected"
  | "send_failed"
  | "request_ended";
interface PendingReply {
  resolve: (result: unknown) => void;
  reject: (error: RelayRpcError) => void;
  signal: AbortSignal;
  onAbort: () => void;
}

export class RelayRpcError extends Error {
  constructor(readonly code: Failure) {
    super(code);
  }
}

/** An authenticated socket carries only bounded, in-memory requests and replies. */
export class RelayRpc {
  #pending = new Map<string, PendingReply>();
  #incoming = new Set<string>();
  #closed = false;

  constructor(
    private readonly send: (wire: string) => void,
    private readonly maximumBytes: number,
    private readonly capacity: number,
    private readonly request: (
      method: string,
      value: unknown,
    ) => Promise<unknown>,
  ) {}

  get closed(): boolean {
    return this.#closed;
  }

  async call(
    method: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this.#closed) throw new RelayRpcError("disconnected");
    if (this.#pending.size >= this.capacity) throw new RelayRpcError("busy");
    signal.throwIfAborted();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const onAbort = () => this.#settle(id, undefined, "request_ended");
      this.#pending.set(id, { resolve, reject, signal, onAbort });
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        this.#write({ id, method, payload });
      } catch {
        this.#settle(id, undefined, "send_failed");
      }
    });
  }

  async receive(wire: string): Promise<void> {
    if (this.#closed) return;
    if (Buffer.byteLength(wire) > this.maximumBytes)
      throw new Error("Relay message exceeded its limit");
    const frame: unknown = JSON.parse(wire);
    if (
      typeof frame !== "object" ||
      frame === null ||
      !("id" in frame) ||
      typeof frame.id !== "string" ||
      !/^[a-f0-9-]{36}$/.test(frame.id)
    )
      throw new Error("Invalid relay message");
    const { id } = frame;
    if (!("method" in frame)) {
      if ("error" in frame)
        this.#settle(
          id,
          undefined,
          frame.error === "busy" ? "busy" : "operation_failed",
        );
      else if ("result" in frame) this.#settle(id, frame.result, null);
      else throw new Error("Invalid relay reply");
      return;
    }
    if (typeof frame.method !== "string" || !("payload" in frame))
      throw new Error("Invalid relay request");
    if (this.#incoming.has(id))
      throw new Error("Duplicate in-flight relay request");
    if (this.#incoming.size >= this.capacity) {
      this.#write({ id, error: "busy" });
      return;
    }
    this.#incoming.add(id);
    try {
      const result = await this.request(frame.method, frame.payload);
      this.#writeResponse({ id, result: result ?? null });
    } catch {
      this.#writeResponse({ id, error: "request_failed" });
    } finally {
      this.#incoming.delete(id);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const id of this.#pending.keys())
      this.#settle(id, undefined, "disconnected");
  }

  #settle(id: string, value: unknown, error: Failure | null): void {
    const pending = this.#pending.get(id);
    if (!pending) return;
    this.#pending.delete(id);
    pending.signal.removeEventListener("abort", pending.onAbort);
    if (error !== null) pending.reject(new RelayRpcError(error));
    else pending.resolve(value);
  }

  #write(message: Record<string, unknown>): void {
    const wire = JSON.stringify(message);
    if (Buffer.byteLength(wire) > this.maximumBytes)
      throw new Error("Relay message exceeded its limit");
    this.send(wire);
  }

  #writeResponse(message: Record<string, unknown>): void {
    if (!this.#closed) this.#write(message);
  }
}
