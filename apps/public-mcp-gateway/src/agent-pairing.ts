import { createHmac, randomBytes, randomInt } from "node:crypto";
import {
  isRendererMcpScope,
  type RendererMcpScope,
} from "@latex-renderer/contracts";
import type { VerifiedAgentChannel } from "./agent-channels.js";
import {
  consentProof,
  type ConsentProof,
  type ConsentSession,
  type OAuthAuthorizationRequest,
} from "./oauth-tokens.js";

export const pairingLifetimeMs = 5 * 60_000;

export interface ClaimedPairing {
  id: string;
  nonce: string;
  clientId: string;
  scopes: readonly RendererMcpScope[];
  expiresAt: number;
}

export interface LocalPairingApproval {
  id: string;
  nonce: string;
  localProfileId: string;
  localGrantId: string;
  scopes: readonly RendererMcpScope[];
}

export interface AgentPairingStore {
  start(
    proof: ConsentProof,
    codeHash: string,
    request: OAuthAuthorizationRequest,
    now: number,
    expiresAt: number,
  ): "created" | "collision" | "unavailable";
  claim(
    agent: VerifiedAgentChannel,
    codeHash: string,
    profileId: string,
    nonce: string,
    now: number,
    limits: PairingAttemptLimits,
  ): ClaimedPairing | undefined;
  approve(
    agent: VerifiedAgentChannel,
    approval: LocalPairingApproval,
    now: number,
  ): boolean;
  approved(proof: ConsentProof, now: number): PairingPreview | undefined;
}

export interface PairingAttemptLimits {
  perTransport: number;
  perInstance: number;
  total: number;
}

export interface PairingPreview {
  instanceId: string;
  localProfileId: string;
  scopes: readonly RendererMcpScope[];
}

export class GatewayAgentPairing {
  readonly #codeKey: Buffer;

  constructor(
    private readonly store: AgentPairingStore,
    key: Uint8Array,
    private readonly limits: PairingAttemptLimits,
    private readonly clock: () => number = Date.now,
  ) {
    if (
      key.byteLength !== 32 ||
      !Object.values(limits).every(
        (limit) => Number.isSafeInteger(limit) && limit > 0,
      )
    )
      throw new Error("Invalid agent pairing settings");
    this.#codeKey = Buffer.from(key);
  }

  start(session: ConsentSession, request: OAuthAuthorizationRequest): string {
    const proof = consentProof(session, request),
      now = this.clock();
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = String(randomInt(100_000_000)).padStart(8, "0");
      const status = this.store.start(
        proof,
        this.#codeHash(code),
        request,
        now,
        now + pairingLifetimeMs,
      );
      if (status === "created") return code;
      if (status === "unavailable") break;
    }
    throw new Error("Pairing could not be started");
  }

  /** The profile comes from the authenticated Renderer session, via a verified agent. */
  claim(
    agent: VerifiedAgentChannel,
    localProfileId: string,
    code: string,
  ): ClaimedPairing | undefined {
    if (!/^[0-9]{8}$/.test(code) || !localProfileId) return undefined;
    return this.store.claim(
      agent,
      this.#codeHash(code),
      localProfileId,
      randomBytes(32).toString("base64url"),
      this.clock(),
      this.limits,
    );
  }

  approve(
    agent: VerifiedAgentChannel,
    approval: LocalPairingApproval,
  ): boolean {
    if (
      !approval.localProfileId ||
      !approval.localGrantId ||
      !approval.scopes.length ||
      !approval.scopes.every(isRendererMcpScope)
    )
      return false;
    return this.store.approve(agent, approval, this.clock());
  }

  approved(
    session: ConsentSession,
    request: OAuthAuthorizationRequest,
  ): PairingPreview | undefined {
    return this.store.approved(consentProof(session, request), this.clock());
  }

  #codeHash(code: string): string {
    return createHmac("sha256", this.#codeKey)
      .update("renderer-pairing-v1\0")
      .update(code)
      .digest("hex");
  }
}
