import { createPublicKey, verify } from "node:crypto";
import {
  rendererRelayAgentEnrollmentSchema,
  rendererRelayEnrollmentMessage,
  type RendererRelayAgentEnrollment,
} from "@latex-renderer/contracts";

export function verifyAgentEnrollment(
  raw: unknown,
  gatewayOrigin: string,
  expectedNonce: string,
): RendererRelayAgentEnrollment | null {
  const parsed = rendererRelayAgentEnrollmentSchema.safeParse(raw);
  if (!parsed.success) return null;
  const enrollment = parsed.data;
  if (
    enrollment.agentPublicKey === enrollment.instance.publicKey ||
    enrollment.nonce !== expectedNonce
  )
    return null;
  if (
    !verifySignature(
      enrollment.instance.publicKey,
      enrollment.instanceSignature,
      rendererRelayEnrollmentMessage(enrollment, gatewayOrigin, "instance"),
    ) ||
    !verifySignature(
      enrollment.agentPublicKey,
      enrollment.agentSignature,
      rendererRelayEnrollmentMessage(enrollment, gatewayOrigin, "agent"),
    )
  )
    return null;
  return enrollment;
}

export function verifySignature(
  publicKey: string,
  signature: string,
  message: string,
): boolean {
  const keyBytes = Buffer.from(publicKey, "base64url");
  const signatureBytes = Buffer.from(signature, "base64url");
  if (
    keyBytes.toString("base64url") !== publicKey ||
    signatureBytes.toString("base64url") !== signature
  )
    return false;
  try {
    return verify(
      null,
      Buffer.from(message),
      createPublicKey({
        key: { kty: "OKP", crv: "Ed25519", x: publicKey },
        format: "jwk",
      }),
      signatureBytes,
    );
  } catch {
    return false;
  }
}
