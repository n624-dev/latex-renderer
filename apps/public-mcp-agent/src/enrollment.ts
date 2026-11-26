import {
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import {
  rendererRelayEnrollmentMessage,
  rendererRelayVersion,
  type RendererRelayAgentEnrollment,
} from "@latex-renderer/contracts";

export interface AgentEnrollmentKeys {
  instanceId: string;
  instancePrivateKey: KeyObject;
  agentPrivateKey: KeyObject;
}

/** A new installation or an explicit clone gets keys distinct from its source. */
export function createAgentEnrollmentKeys(): AgentEnrollmentKeys {
  return {
    instanceId: `instance_${randomUUID().replaceAll("-", "")}`,
    instancePrivateKey: generateKeyPairSync("ed25519").privateKey,
    agentPrivateKey: generateKeyPairSync("ed25519").privateKey,
  };
}

/** Replace a transport key without changing the installation identity. */
export function replaceAgentEnrollmentKey(
  keys: AgentEnrollmentKeys,
): AgentEnrollmentKeys {
  return {
    ...keys,
    agentPrivateKey: generateKeyPairSync("ed25519").privateKey,
  };
}

export function signAgentEnrollment(
  keys: AgentEnrollmentKeys,
  nonce: string,
  gatewayOrigin: string,
): RendererRelayAgentEnrollment {
  const body: Omit<
    RendererRelayAgentEnrollment,
    "instanceSignature" | "agentSignature"
  > = {
    version: rendererRelayVersion,
    instance: {
      id: keys.instanceId,
      publicKey: publicKeyOf(keys.instancePrivateKey),
    },
    agentPublicKey: publicKeyOf(keys.agentPrivateKey),
    nonce,
  };
  return {
    ...body,
    instanceSignature: sign(
      null,
      Buffer.from(
        rendererRelayEnrollmentMessage(body, gatewayOrigin, "instance"),
      ),
      keys.instancePrivateKey,
    ).toString("base64url"),
    agentSignature: sign(
      null,
      Buffer.from(rendererRelayEnrollmentMessage(body, gatewayOrigin, "agent")),
      keys.agentPrivateKey,
    ).toString("base64url"),
  };
}

export interface AgentEnrollmentClient {
  getNonce(signal: AbortSignal): Promise<string>;
  register(
    proof: RendererRelayAgentEnrollment,
    signal: AbortSignal,
  ): Promise<{ transportId: string }>;
}

/** The skip action completes setup without loading keys or touching the network. */
export async function configureAgentEnrollment(
  action: "skip" | "connect",
  configuration: () => {
    gatewayOrigin: string;
    keys: AgentEnrollmentKeys;
    client: AgentEnrollmentClient;
  },
  signal: AbortSignal,
): Promise<
  { status: "skipped" } | { status: "registered"; transportId: string }
> {
  if (action === "skip") return { status: "skipped" };
  signal.throwIfAborted();
  const { gatewayOrigin, keys, client } = configuration();
  const nonce = await client.getNonce(signal);
  const proof = signAgentEnrollment(keys, nonce, gatewayOrigin);
  const { transportId } = await client.register(proof, signal);
  return { status: "registered", transportId };
}

function publicKeyOf(key: KeyObject): string {
  if (key.asymmetricKeyType !== "ed25519" || key.type !== "private")
    throw new Error("Agent enrollment requires Ed25519 private keys");
  const jwk = createPublicKey(key).export({ format: "jwk" });
  if (!jwk.x) throw new Error("Ed25519 public key is unavailable");
  return jwk.x;
}
