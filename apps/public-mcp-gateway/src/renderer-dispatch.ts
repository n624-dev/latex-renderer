import {
  rendererMcpToolPolicies,
  type RendererMcpTool,
  type RendererRelayOperation,
} from "@latex-renderer/contracts";
import {
  isActiveAuthorization,
  type ConnectionAuthorization,
  type ConnectionStore,
  type ConnectionTransport,
} from "./connections.js";

export class DispatchFailure extends Error {
  constructor(
    readonly code:
      | "insufficient_scope"
      | "connection_revoked"
      | "connection_offline"
      | "outcome_unknown"
      | "renderer_upgrade_required"
      | "reauthentication_required"
      | "renderer_unavailable"
      | "gateway_busy"
      | "invalid_reference"
      | "invalid_operation",
  ) {
    super(code);
  }
}

interface DestinationRequest {
  authorization: ConnectionAuthorization;
  transport: ConnectionTransport;
  operation: RendererRelayOperation;
  signal: AbortSignal;
}

export type DispatchTransport = (
  request: DestinationRequest,
) => Promise<unknown>;

export function asRendererTool(name: string): RendererMcpTool | undefined {
  if (name === "verify_attachment_delivery_origin") return undefined;
  return Object.hasOwn(rendererMcpToolPolicies, name)
    ? (name as RendererMcpTool)
    : undefined;
}

export class RendererDispatch {
  #active = 0;
  #activeCancellation = 0;

  constructor(
    private readonly store: Pick<
      ConnectionStore,
      "authorization" | "transport"
    >,
    private readonly transports: {
      https: DispatchTransport;
      agent: DispatchTransport;
    },
    private readonly capacity: number,
    private readonly clock = Date.now,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Gateway dispatch capacity is required");
  }

  async call(
    token: ConnectionAuthorization,
    operation: RendererRelayOperation,
    signal: AbortSignal,
  ): Promise<unknown> {
    const now = this.clock();
    const authorization = this.store.authorization(token.id);
    if (
      !authorization ||
      !isActiveAuthorization(token, now) ||
      authorization.instanceId !== token.instanceId ||
      authorization.profileId !== token.profileId ||
      authorization.revokedAt !== null ||
      authorization.expiresAt <= now
    )
      throw new DispatchFailure("connection_revoked");
    if (authorization.reauthRequired)
      throw new DispatchFailure("reauthentication_required");
    const transport = this.store.transport(authorization.transportId);
    if (
      !transport ||
      transport.instanceId !== authorization.instanceId ||
      transport.disabledAt !== null
    )
      throw new DispatchFailure("connection_revoked");
    const scopes = token.scopes.filter((scope) =>
      authorization.scopes.includes(scope),
    );
    const tool =
      operation.method === "tools/call"
        ? asRendererTool(operation.name)
        : undefined;
    if (operation.method === "tools/call" && (!tool || tool === "get_profile"))
      throw new DispatchFailure("invalid_operation");
    const scope = tool ? rendererMcpToolPolicies[tool].scope : "mcp:read";
    if (scope && !scopes.includes(scope))
      throw new DispatchFailure("insufficient_scope");
    const cancellation = tool === "cancel_render";
    if (
      (cancellation ? this.#activeCancellation : this.#active) >= this.capacity
    )
      throw new DispatchFailure("gateway_busy");
    if (cancellation) this.#activeCancellation++;
    else this.#active++;
    try {
      return await this.transports[transport.endpoint.kind]({
        authorization: { ...authorization, scopes },
        transport,
        operation,
        signal,
      });
    } catch (error) {
      if (error instanceof DispatchFailure) throw error;
      // Once forwarded, an interrupted write may already have been accepted.
      const retry = tool ? rendererMcpToolPolicies[tool].replay : "read";
      throw new DispatchFailure(
        retry === "read" ? "renderer_unavailable" : "outcome_unknown",
      );
    } finally {
      if (cancellation) this.#activeCancellation--;
      else this.#active--;
    }
  }
}
