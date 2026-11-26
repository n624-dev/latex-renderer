import { createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  rendererRelayIdentityMessage,
  rendererRelayIdentitySchema,
  rendererRelayVersion,
} from "@latex-renderer/contracts";
import type { RemoteAccess } from "@latex-renderer/remote-mcp-core";

export function rendererIdentityFromEnvironment(
  origin: string,
  environment: NodeJS.ProcessEnv,
) {
  const id = environment.RENDERER_RELAY_INSTANCE_ID;
  const keyPath = environment.RENDERER_RELAY_INSTANCE_KEY_FILE;
  if (id === undefined && keyPath === undefined) return undefined;
  if (!id || !keyPath)
    throw new Error("Renderer relay needs its instance ID and key file");
  const key = createPrivateKey(readFileSync(keyPath));
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("Invalid Renderer installation key");
  const instance = rendererRelayIdentitySchema.parse({
    id,
    publicKey: createPublicKey(key).export({ format: "jwk" }).x,
  });
  return {
    instance,
    proof(access: RemoteAccess, nonce: string) {
      const body = {
        version: rendererRelayVersion,
        instance,
        profile: access.userId,
        grant: access.grantId,
      } as const;
      return {
        ...body,
        signature: sign(
          null,
          Buffer.from(rendererRelayIdentityMessage(origin, nonce, body)),
          key,
        ).toString("base64url"),
      };
    },
  };
}
