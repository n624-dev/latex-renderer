import { randomBytes } from "node:crypto";
import type { ConnectionStore } from "./connections.js";

export interface VerifiedAgentChannel {
  instanceId: string;
  transportId: string;
  publicKey: string;
}

export interface AgentChannel {
  close(): void;
}

interface ConnectedAgent<
  Control extends AgentChannel,
  Files extends AgentChannel,
> {
  readonly identity: VerifiedAgentChannel;
  readonly generation: string;
  readonly control: Control;
  files: Files | undefined;
}

/** Owns two independently authenticated channels for the current connection generation. */
export class ConnectedAgents<
  Control extends AgentChannel,
  Files extends AgentChannel,
> {
  readonly #connections = new Map<string, ConnectedAgent<Control, Files>>();

  constructor(
    private readonly transports: Pick<ConnectionStore, "transport">,
  ) {}

  attachControl(
    identity: VerifiedAgentChannel,
    control: Control,
  ): string | undefined {
    if (!this.#active(identity)) return undefined;
    const previous = this.#connections.get(identity.transportId);
    const generation = randomBytes(24).toString("base64url");
    this.#connections.set(identity.transportId, {
      identity: { ...identity },
      generation,
      control,
      files: undefined,
    });
    if (previous) closeChannels(previous);
    return generation;
  }

  attachFiles(
    identity: VerifiedAgentChannel,
    generation: string,
    files: Files,
  ): boolean {
    const connection = this.#connections.get(identity.transportId);
    if (
      !connection ||
      connection.files ||
      connection.generation !== generation ||
      connection.identity.instanceId !== identity.instanceId ||
      connection.identity.publicKey !== identity.publicKey ||
      !this.#active(identity)
    )
      return false;
    connection.files = files;
    return true;
  }

  control(transportId: string): Control | undefined {
    return this.#current(transportId)?.control;
  }

  files(transportId: string, generation: string): Files | undefined {
    const current = this.#current(transportId);
    return current?.generation === generation ? current.files : undefined;
  }

  detachControl(transportId: string, generation: string): void {
    const current = this.#connections.get(transportId);
    if (current?.generation !== generation) return;
    this.#connections.delete(transportId);
    closeChannels(current);
  }

  detachFiles(transportId: string, generation: string, channel: Files): void {
    const current = this.#connections.get(transportId);
    if (current?.generation === generation && current.files === channel)
      current.files = undefined;
  }

  #current(transportId: string): ConnectedAgent<Control, Files> | undefined {
    const current = this.#connections.get(transportId);
    if (current && !this.#active(current.identity)) {
      this.detachControl(transportId, current.generation);
      return undefined;
    }
    return current;
  }

  #active(identity: VerifiedAgentChannel): boolean {
    const transport = this.transports.transport(identity.transportId);
    return (
      transport?.disabledAt === null &&
      transport.instanceId === identity.instanceId &&
      transport.endpoint.kind === "agent" &&
      transport.endpoint.publicKey === identity.publicKey
    );
  }
}

function closeChannels(connection: {
  control: AgentChannel;
  files: AgentChannel | undefined;
}): void {
  try {
    connection.control.close();
  } finally {
    connection.files?.close();
  }
}
