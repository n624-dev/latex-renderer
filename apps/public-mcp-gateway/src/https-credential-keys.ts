import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  isRendererMcpScope,
  type RendererMcpScope,
} from "@latex-renderer/contracts";

export interface HttpsCredentials {
  clientId: string;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: RendererMcpScope[];
}

const keyIdPattern = /^[A-Za-z0-9_-]{1,64}$/;
const encodedPattern = /^[A-Za-z0-9_-]+$/;

export class HttpsCredentialKeys {
  readonly #keys = new Map<string, Buffer>();

  constructor(
    readonly activeKeyId: string,
    keys: ReadonlyMap<string, Uint8Array>,
  ) {
    for (const [id, key] of keys) {
      if (!keyIdPattern.test(id) || key.byteLength !== 32)
        throw new Error("Invalid public MCP credential key");
      this.#keys.set(id, Buffer.from(key));
    }
    if (!this.#keys.has(activeKeyId))
      throw new Error("Active public MCP credential key is missing");
  }

  seal(authorizationId: string, credentials: HttpsCredentials): string {
    const plaintext = JSON.stringify(credentials);
    decodeCredentials(plaintext);
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.#key(this.activeKeyId),
      nonce,
    );
    cipher.setAAD(credentialContext(this.activeKeyId, authorizationId));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext),
      cipher.final(),
    ]);
    return [
      "v1",
      this.activeKeyId,
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  open(authorizationId: string, envelope: string): HttpsCredentials {
    const [version, keyId, nonce, tag, ciphertext, ...extra] =
      envelope.split(".");
    if (
      version !== "v1" ||
      !keyId ||
      !nonce ||
      !tag ||
      !ciphertext ||
      extra.length
    )
      throw new Error("Invalid public MCP credential envelope");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#key(keyId),
      decode(nonce, 12),
      { authTagLength: 16 },
    );
    decipher.setAAD(credentialContext(keyId, authorizationId));
    decipher.setAuthTag(decode(tag, 16));
    let plaintext: string;
    try {
      plaintext = Buffer.concat([
        decipher.update(decode(ciphertext)),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("Could not authenticate public MCP credentials");
    }
    return decodeCredentials(plaintext);
  }

  #key(id: string): Buffer {
    const key = this.#keys.get(id);
    if (key === undefined)
      throw new Error("Public MCP credential key is unavailable");
    return key;
  }
}

function decode(value: string, length?: number): Buffer {
  const bytes = Buffer.from(value, "base64url");
  if (
    !encodedPattern.test(value) ||
    bytes.toString("base64url") !== value ||
    (length !== undefined && bytes.byteLength !== length)
  )
    throw new Error("Invalid public MCP credential envelope");
  return bytes;
}

function credentialContext(keyId: string, authorizationId: string): Buffer {
  return Buffer.from(
    JSON.stringify([
      "public-mcp-https-credentials",
      "v1",
      keyId,
      authorizationId,
    ]),
  );
}

function decodeCredentials(plaintext: string): HttpsCredentials {
  try {
    const value: unknown = JSON.parse(plaintext);
    if (
      typeof value === "object" &&
      value !== null &&
      "clientId" in value &&
      typeof value.clientId === "string" &&
      value.clientId.length &&
      "accessToken" in value &&
      typeof value.accessToken === "string" &&
      value.accessToken.length &&
      "refreshToken" in value &&
      (value.refreshToken === null ||
        (typeof value.refreshToken === "string" &&
          value.refreshToken.length)) &&
      "expiresAt" in value &&
      typeof value.expiresAt === "number" &&
      Number.isSafeInteger(value.expiresAt) &&
      value.expiresAt > 0 &&
      "scopes" in value &&
      Array.isArray(value.scopes) &&
      value.scopes.length &&
      value.scopes.every(
        (scope): scope is RendererMcpScope =>
          typeof scope === "string" && isRendererMcpScope(scope),
      )
    )
      return {
        clientId: value.clientId,
        accessToken: value.accessToken,
        refreshToken: value.refreshToken,
        expiresAt: value.expiresAt,
        scopes: value.scopes,
      };
  } catch {
    // Avoid propagating parser errors that may quote plaintext credentials.
  }
  throw new Error("Invalid public MCP credentials");
}
