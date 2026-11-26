import { sign, type KeyObject } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import {
  rendererRelayAgentPaths,
  rendererRelaySocketMessage,
  rendererRelayVersion,
} from "@latex-renderer/contracts";
import { RelayRpc } from "@latex-renderer/shared/relay-rpc";

interface LiveChannel {
  generation: string;
  rpc: RelayRpc;
  closed: Promise<number>;
  close(): void;
}

export class AgentGatewayConnection {
  #control: LiveChannel | undefined;

  constructor(
    private readonly options: {
      origin: string;
      instanceId: string;
      transportId: string;
      key: KeyObject;
      maximumBytes: number;
      capacity: number;
      timeoutMs: number;
      execute: (method: string, payload: unknown) => Promise<unknown>;
    },
  ) {
    const origin = URL.parse(options.origin);
    if (
      !origin ||
      origin.origin !== options.origin ||
      origin.protocol !== "https:" ||
      options.key.asymmetricKeyType !== "ed25519"
    )
      throw new Error("Invalid outbound agent connection configuration");
  }

  get online(): boolean {
    return this.#control !== undefined && !this.#control.rpc.closed;
  }

  call(
    method: string,
    payload: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (!this.#control)
      return Promise.reject(new Error("ChatGPT gateway is offline"));
    return this.#control.rpc.call(
      method,
      payload,
      AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)]),
    );
  }

  async run(signal: AbortSignal): Promise<void> {
    let backoff = 1_000;
    while (!signal.aborted) {
      try {
        const control = await this.#connect("control", null, signal);
        this.#control = control;
        backoff = 1_000;
        const fileSession = new AbortController();
        const files = this.#runFiles(
          control.generation,
          AbortSignal.any([signal, fileSession.signal]),
        );
        const code = await control.closed;
        fileSession.abort();
        await files;
        if (code === 1008) throw new RejectedAgent();
      } catch (error) {
        if (error instanceof RejectedAgent) throw error;
      } finally {
        this.#control?.close();
        this.#control = undefined;
      }
      await delay(
        backoff + Math.floor((Math.random() * backoff) / 2),
        undefined,
        { signal },
      ).catch(() => undefined);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }

  async #runFiles(generation: string, signal: AbortSignal): Promise<void> {
    let backoff = 1_000;
    while (!signal.aborted) {
      try {
        const files = await this.#connect("files", generation, signal);
        backoff = 1_000;
        await files.closed;
      } catch {
        // The control connection can still accept cancellations while the file channel reconnects.
      }
      await delay(
        backoff + Math.floor((Math.random() * backoff) / 2),
        undefined,
        { signal },
      ).catch(() => undefined);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }

  #connect(
    kind: "control" | "files",
    generation: string | null,
    signal: AbortSignal,
  ): Promise<LiveChannel> {
    const {
      origin,
      instanceId,
      transportId,
      key,
      timeoutMs,
      maximumBytes,
      capacity,
      execute,
    } = this.options;
    const url = new URL(rendererRelayAgentPaths[kind], origin);
    url.protocol = "wss:";
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const ws = new WebSocket(url, {
        handshakeTimeout: timeoutMs,
        maxPayload: maximumBytes,
        perMessageDeflate: false,
        followRedirects: false,
      });
      const timer = setTimeout(() => ws.terminate(), timeoutMs).unref();
      let lastHeartbeat = Date.now();
      const heartbeat = setInterval(() => {
        if (Date.now() - lastHeartbeat > 90_000) ws.terminate();
      }, 30_000).unref();
      ws.on("ping", () => {
        lastHeartbeat = Date.now();
      });
      const stop = () => ws.terminate();
      signal.addEventListener("abort", stop, { once: true });
      let notifyClosed: (code: number) => void = () => undefined;
      const closed = new Promise<number>((done) => {
        notifyClosed = done;
      });
      const rpc = new RelayRpc(
        (wire) => {
          if (
            ws.readyState !== WebSocket.OPEN ||
            ws.bufferedAmount + Buffer.byteLength(wire) > maximumBytes
          )
            throw new Error("Agent output is full");
          ws.send(wire);
        },
        maximumBytes,
        capacity,
        execute,
      );
      let challengeSent = false,
        authenticated = false;
      ws.on("error", () => ws.terminate());
      ws.on("close", (code) => {
        clearTimeout(timer);
        clearInterval(heartbeat);
        signal.removeEventListener("abort", stop);
        rpc.close();
        notifyClosed(code);
        if (!authenticated)
          reject(
            code === 1008
              ? new RejectedAgent()
              : new Error("Gateway handshake failed"),
          );
      });
      ws.on("message", (raw, binary) => {
        const wire = (
          Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw as Uint8Array)
        ).toString("utf8");
        if (binary) {
          ws.terminate();
          return;
        }
        if (authenticated) {
          void rpc.receive(wire).catch(() => ws.terminate());
          return;
        }
        try {
          if (Buffer.byteLength(wire) > 1024)
            throw new Error("Invalid gateway handshake");
          const frame: unknown = JSON.parse(wire);
          if (
            typeof frame !== "object" ||
            frame === null ||
            !("version" in frame) ||
            frame.version !== rendererRelayVersion
          )
            throw new Error("Unsupported gateway relay protocol");
          if (
            !challengeSent &&
            "nonce" in frame &&
            typeof frame.nonce === "string" &&
            /^[A-Za-z0-9_-]{43}$/.test(frame.nonce)
          ) {
            const proof = {
              version: rendererRelayVersion,
              instanceId,
              transportId,
              generation,
            } as const;
            const signature = sign(
              null,
              Buffer.from(
                rendererRelaySocketMessage(origin, kind, frame.nonce, proof),
              ),
              key,
            ).toString("base64url");
            ws.send(JSON.stringify({ ...proof, signature }));
            challengeSent = true;
            return;
          }
          if (
            !challengeSent ||
            !("generation" in frame) ||
            typeof frame.generation !== "string" ||
            !/^[A-Za-z0-9_-]{32}$/.test(frame.generation) ||
            (generation !== null && generation !== frame.generation)
          )
            throw new Error("Unsupported gateway connection generation");
          authenticated = true;
          clearTimeout(timer);
          resolve({ generation: frame.generation, rpc, closed, close: stop });
        } catch {
          ws.close(1008, "invalid gateway handshake");
        }
      });
    });
  }
}

class RejectedAgent extends Error {
  constructor() {
    super(
      "The gateway rejected the agent. Review its registration before restarting.",
    );
  }
}
