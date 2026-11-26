import { createHash, randomBytes } from "node:crypto";
import type { RendererRelayAgentEnrollment } from "@latex-renderer/contracts";
import { verifyAgentEnrollment } from "./agent-enrollment-proof.js";

export interface AgentEnrollmentStore {
  registerEnrollmentNonce(
    hash: string,
    expiresAt: number,
    now: number,
    capacity: number,
  ): boolean;
  consumeAgentEnrollment(
    enrollment: RendererRelayAgentEnrollment,
    nonceHash: string,
    now: number,
    capacity: number,
  ): string | undefined;
}

export class GatewayAgentEnrollment {
  constructor(
    readonly gatewayOrigin: string,
    readonly store: AgentEnrollmentStore,
    readonly limits: {
      lifetimeMs: number;
      pending: number;
      registrations: number;
    },
    readonly clock: () => number = Date.now,
  ) {
    const gateway = URL.parse(gatewayOrigin);
    if (
      !gateway ||
      gateway.protocol !== "https:" ||
      gateway.origin !== gatewayOrigin ||
      !Object.values(limits).every(
        (value) => Number.isSafeInteger(value) && value > 0,
      )
    )
      throw new Error("Invalid gateway agent enrollment settings");
  }

  begin(): string {
    const nonce = randomBytes(32).toString("base64url"),
      now = this.clock();
    if (
      !this.store.registerEnrollmentNonce(
        hashNonce(nonce),
        now + this.limits.lifetimeMs,
        now,
        this.limits.pending,
      )
    )
      throw new Error("Agent enrollment is temporarily unavailable");
    return nonce;
  }

  complete(proof: unknown): { transportId: string } {
    const nonce =
      typeof proof === "object" && proof !== null && "nonce" in proof
        ? proof.nonce
        : undefined;
    if (typeof nonce !== "string") throw invalidEnrollment();
    const verified = verifyAgentEnrollment(proof, this.gatewayOrigin, nonce);
    if (!verified) throw invalidEnrollment();
    const transportId = this.store.consumeAgentEnrollment(
      verified,
      hashNonce(nonce),
      this.clock(),
      this.limits.registrations,
    );
    if (!transportId) throw invalidEnrollment();
    return { transportId };
  }
}

function hashNonce(nonce: string): string {
  return createHash("sha256").update(nonce).digest("hex");
}

function invalidEnrollment(): Error {
  return new Error("Agent enrollment is invalid or unavailable");
}
