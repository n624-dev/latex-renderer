import { randomBytes } from "node:crypto";
import type { Server } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import { z } from "zod";
import {
  rendererRelayAgentPaths,
  rendererRelayScopeSchema,
  rendererRelaySocketMessage,
  rendererRelaySocketProofSchema,
  rendererRelayVersion,
  type RendererRelayDownloadRequest,
} from "@latex-renderer/contracts";
import { RelayRpc, RelayRpcError } from "@latex-renderer/shared/relay-rpc";
import { ConnectedAgents } from "./agent-channels.js";
import type { GatewayAgentPairing } from "./agent-pairing.js";
import { verifySignature } from "./agent-enrollment-proof.js";
import type { ConnectionStore } from "./connections.js";
import {
  DispatchFailure,
  type DispatchTransport,
} from "./renderer-dispatch.js";

interface Channel {
  close(): void;
  rpc: RelayRpc;
  generation: string;
}

const pairClaim = z
  .object({
    code: z.string().regex(/^\d{8}$/),
    localProfileId: z.string().max(256).min(1),
  })
  .strict();
const pairApprove = z
  .object({
    id: z.string().max(128),
    nonce: z.string().max(128),
    localProfileId: z.string().max(256).min(1),
    localGrantId: z.string().max(256).min(1),
    scopes: z.array(rendererRelayScopeSchema).min(1).max(4),
  })
  .strict();

export function createGatewayAgentSockets(options: {
  origin: string;
  store: ConnectionStore;
  pairing: GatewayAgentPairing;
  maxFrameBytes: number;
  capacity: number;
  maxSockets: number;
  timeoutMs: number;
  heartbeatMs: number;
}) {
  const agents = new ConnectedAgents<Channel, Channel>(options.store);
  const sockets = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: options.maxFrameBytes,
  });
  const expectedHost = new URL(options.origin).host;
  const delivering = new Set<string>();

  async function deliverRevocations(transportId: string): Promise<void> {
    const channel = agents.control(transportId);
    if (!channel || delivering.has(transportId)) return;
    delivering.add(transportId);
    try {
      for (const grant of options.store.pendingAgentRevocations(
        transportId,
        Date.now(),
      )) {
        const result = await channel.rpc.call(
          "renderer.revoke",
          { grant },
          AbortSignal.timeout(options.timeoutMs),
        );
        if (
          !result ||
          typeof result !== "object" ||
          !("revoked" in result) ||
          result.revoked !== true
        )
          return;
        options.store.acknowledgeAgentRevocation(transportId, grant);
      }
    } catch {
      // The next authenticated heartbeat or reconnect resumes delivery.
    } finally {
      delivering.delete(transportId);
    }
  }

  function listen(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      const kind =
        request.url === rendererRelayAgentPaths.control
          ? "control"
          : request.url === rendererRelayAgentPaths.files
            ? "files"
            : undefined;
      if (
        !kind ||
        request.headers.host !== expectedHost ||
        sockets.clients.size >= options.maxSockets
      ) {
        socket.destroy();
        return;
      }
      sockets.handleUpgrade(request, socket, head, (ws) => accept(ws, kind));
    });
  }

  function accept(ws: WebSocket, kind: "control" | "files"): void {
    const nonce = randomBytes(32).toString("base64url");
    const deadline = setTimeout(
      () => ws.terminate(),
      options.timeoutMs,
    ).unref();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let disconnect: (() => void) | undefined;
    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      clearTimeout(deadline);
      clearInterval(heartbeat);
      disconnect?.();
    });
    ws.once("message", (raw, binary) => {
      try {
        const wire = wireText(raw);
        if (binary || Buffer.byteLength(wire) > 1024)
          throw new Error("Invalid agent handshake");
        const proof = rendererRelaySocketProofSchema.parse(
          JSON.parse(wire) as unknown,
        );
        const transport = options.store.transport(proof.transportId);
        if (
          !transport ||
          transport.instanceId !== proof.instanceId ||
          transport.disabledAt !== null ||
          transport.endpoint.kind !== "agent" ||
          (kind === "control") !== (proof.generation === null) ||
          !verifySignature(
            transport.endpoint.publicKey,
            proof.signature,
            rendererRelaySocketMessage(options.origin, kind, nonce, proof),
          )
        ) {
          ws.close(1008, "agent authorization required");
          return;
        }
        const identity = {
          transportId: transport.id,
          instanceId: transport.instanceId,
          publicKey: transport.endpoint.publicKey,
        };
        const rpc = new RelayRpc(
          (message) => {
            if (
              ws.readyState !== WebSocket.OPEN ||
              ws.bufferedAmount + Buffer.byteLength(message) >
                options.maxFrameBytes
            )
              throw new Error("Relay output is full");
            ws.send(message);
          },
          options.maxFrameBytes,
          options.capacity,
          (method, payload) => {
            if (kind !== "control" || agents.control(transport.id) !== channel)
              throw new Error("Agent control is unavailable");
            if (method === "pair.claim") {
              const { code, localProfileId } = pairClaim.parse(payload);
              return Promise.resolve(
                options.pairing.claim(identity, localProfileId, code),
              );
            }
            if (method === "pair.approve")
              return Promise.resolve(
                options.pairing.approve(identity, pairApprove.parse(payload)),
              );
            if (method === "pair.revoke") {
              const { grant } = z
                .object({
                  grant: z.string().regex(/^relay_grant_[a-f0-9]{32}$/),
                })
                .strict()
                .parse(payload);
              return Promise.resolve(
                options.store.revokeAgentGrant(transport.id, grant, Date.now()),
              );
            }
            if (method === "agent.retire") {
              return Promise.resolve({
                retired: options.store.disableTransport(
                  transport.id,
                  Date.now(),
                ),
              });
            }
            throw new Error("Unsupported agent request");
          },
        );
        const channel: Channel = {
          rpc,
          generation: proof.generation ?? "",
          close: () => {
            rpc.close();
            ws.terminate();
          },
        };
        if (kind === "control") {
          const generation = agents.attachControl(identity, channel);
          if (!generation) {
            channel.close();
            return;
          }
          channel.generation = generation;
          disconnect = () => {
            rpc.close();
            agents.detachControl(transport.id, generation);
          };
        } else {
          if (!agents.attachFiles(identity, channel.generation, channel)) {
            ws.close(1008, "agent generation required");
            return;
          }
          disconnect = () => {
            rpc.close();
            agents.detachFiles(transport.id, channel.generation, channel);
          };
        }
        clearTimeout(deadline);
        let alive = true;
        ws.on("pong", () => {
          alive = true;
          if (kind === "control") void deliverRevocations(transport.id);
        });
        heartbeat = setInterval(() => {
          if (
            !alive ||
            !agents.control(transport.id) ||
            ws.readyState !== WebSocket.OPEN
          ) {
            channel.close();
            return;
          }
          alive = false;
          ws.ping();
        }, options.heartbeatMs).unref();
        ws.on("message", (message, isBinary) => {
          if (isBinary) {
            channel.close();
            return;
          }
          void rpc.receive(wireText(message)).catch(() => channel.close());
        });
        ws.send(
          JSON.stringify({
            generation: channel.generation,
            version: rendererRelayVersion,
          }),
        );
        if (kind === "control") void deliverRevocations(transport.id);
      } catch {
        ws.close(1008, "agent handshake rejected");
      }
    });
    ws.send(JSON.stringify({ nonce, version: rendererRelayVersion }));
  }

  const dispatch: DispatchTransport = async ({
    authorization,
    transport,
    operation,
    signal,
  }) => {
    const control = agents.control(transport.id);
    const channel =
      operation.method === "tools/call" && operation.name === "cancel_render"
        ? control
        : control && agents.files(transport.id, control.generation);
    if (!channel) throw new DispatchFailure("connection_offline");
    const result = await channel.rpc
      .call(
        "renderer.call",
        {
          version: rendererRelayVersion,
          instanceId: authorization.instanceId,
          grant: authorization.localGrantId,
          scopes: authorization.scopes,
          operation,
        },
        AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
      )
      .catch((error: unknown) => {
        if (error instanceof RelayRpcError && error.code === "busy")
          throw new DispatchFailure("gateway_busy");
        if (error instanceof RelayRpcError && error.code === "send_failed")
          throw new DispatchFailure("connection_offline");
        if (error instanceof Error) throw error;
        throw new Error("Agent request failed");
      });
    if (
      typeof result === "object" &&
      result !== null &&
      "relayStatus" in result
    ) {
      if (result.relayStatus === 401) {
        options.store.requireReauthentication(authorization.id);
        throw new DispatchFailure("reauthentication_required");
      }
      if (result.relayStatus === 403)
        throw new DispatchFailure("insufficient_scope");
      if (result.relayStatus === 404)
        throw new DispatchFailure("renderer_upgrade_required");
      throw new DispatchFailure("renderer_unavailable");
    }
    return result;
  };

  return {
    listen,
    dispatch,
    online(transportId: string): boolean {
      const control = agents.control(transportId);
      return Boolean(control && agents.files(transportId, control.generation));
    },
    deliverRevocations,
    async download(
      transportId: string,
      request: RendererRelayDownloadRequest,
      signal: AbortSignal,
    ) {
      const control = agents.control(transportId);
      const files = control && agents.files(transportId, control.generation);
      if (!files) throw new DispatchFailure("connection_offline");
      return files.rpc.call(
        "renderer.download",
        request,
        AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs)]),
      );
    },
    close() {
      for (const client of sockets.clients) client.terminate();
      sockets.close();
    },
  };
}

function wireText(data: WebSocket.RawData): string {
  return (
    Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as Uint8Array)
  ).toString("utf8");
}
