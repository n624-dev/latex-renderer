import { createHash, createPublicKey, sign, verify } from "node:crypto";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";
import { validateLanHttpsServerOrigin } from "../../packages/server-setup-core/src/lan-https.mjs";

const prefix = "latex-renderer/lan-https/request/v1\n";

export function lanHttpsPublicIdentity(input) {
  const model = profileRecord(input, "LAN HTTPS identity public key", [
    "kty",
    "crv",
    "x",
  ]);
  if (model.kty !== "OKP" || model.crv !== "Ed25519")
    throw new Error("LAN HTTPS identity requires an Ed25519 public key");
  strictBase64Url(model.x, 32);
  const jwk = Object.freeze({ crv: "Ed25519", kty: "OKP", x: model.x });
  createPublicKey({ format: "jwk", key: jwk });
  return Object.freeze({
    installationId: createHash("sha256")
      .update(JSON.stringify(jwk))
      .digest("hex"),
    publicKey: jwk,
  });
}

export function lanHttpsBodyHash(body) {
  if (!Buffer.isBuffer(body) || body.length > 64 * 1024)
    throw new Error("LAN HTTPS request body must be at most 64 KiB");
  return createHash("sha256").update(body).digest("hex");
}

function strictBase64Url(value, bytes) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("LAN HTTPS proof has invalid encoding");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== bytes || decoded.toString("base64url") !== value)
    throw new Error("LAN HTTPS proof has invalid encoding");
  return decoded;
}

function message({ audience, nonce, path, body }) {
  const origin = validateLanHttpsServerOrigin(audience);
  strictBase64Url(nonce, 32);
  if (
    typeof path !== "string" ||
    !/^\/v1\/[a-z]+(?:\/[a-z-]+)*$/.test(path) ||
    path.length > 100
  )
    throw new Error("LAN HTTPS proof requires an exact supported API path");
  return Buffer.from(
    prefix +
      JSON.stringify([origin, "POST", path, nonce, lanHttpsBodyHash(body)]),
  );
}

export function createLanHttpsProof(privateKey, input) {
  const exported = createPublicKey(privateKey).export({ format: "jwk" });
  const identity = lanHttpsPublicIdentity({
    kty: exported.kty,
    crv: exported.crv,
    x: exported.x,
  });
  return Object.freeze({
    installationId: identity.installationId,
    nonce: input.nonce,
    signature: sign(null, message(input), privateKey).toString("base64url"),
  });
}

// The authority must additionally consume this proof's server-issued nonce in
// the same transaction as the authorized mutation. Signature validity alone
// does not authorize registration, change the server's policy or prevent replay.
export function verifyLanHttpsProof(publicKey, proof, input) {
  const model = profileRecord(proof, "LAN HTTPS proof", [
    "installationId",
    "nonce",
    "signature",
  ]);
  const identity = lanHttpsPublicIdentity(publicKey);
  if (
    model.installationId !== identity.installationId ||
    model.nonce !== input.nonce
  )
    throw new Error("LAN HTTPS proof identity or nonce does not match");
  const signature = strictBase64Url(model.signature, 64);
  if (
    !verify(
      null,
      message(input),
      createPublicKey({ format: "jwk", key: identity.publicKey }),
      signature,
    )
  )
    throw new Error("LAN HTTPS request signature was rejected");
  return identity;
}
