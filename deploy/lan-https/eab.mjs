import { createHash, createHmac, createPublicKey } from "node:crypto";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";
import { URL } from "node:url";

function canonicalCoordinate(value) {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    Buffer.from(value, "base64url").toString("base64url") !== value
  )
    throw new Error("ACME account requires canonical P-256 coordinates");
  return value;
}

// Keep the initial public protocol narrow: P-256 is supported by the chosen
// ACME providers. The account's private scalar is never accepted or returned.
export function canonicalLanHttpsAcmePublicKey(input) {
  const model = profileRecord(input, "ACME account public key", [
    "kty",
    "crv",
    "x",
    "y",
  ]);
  if (model.kty !== "EC" || model.crv !== "P-256")
    throw new Error("ACME account requires a P-256 public key");
  const key = Object.freeze({
    crv: "P-256",
    kty: "EC",
    x: canonicalCoordinate(model.x),
    y: canonicalCoordinate(model.y),
  });
  createPublicKey({ key, format: "jwk" });
  return key;
}

export function lanHttpsAcmeAccountId(publicKey) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalLanHttpsAcmePublicKey(publicKey)))
    .digest("base64url");
}

// RFC 8555 section 7.3.4: the response is a JWS over ONE public account key
// and ONE configured newAccount endpoint. It cannot be used to bind a different
// account key or reveal the reusable EAB HMAC secret.
// newAccountUrl and credentials are authority-owned inputs, not request fields.
export function createLanHttpsExternalAccountBinding(
  publicKey,
  { newAccountUrl, kid, hmacKey },
) {
  const key = canonicalLanHttpsAcmePublicKey(publicKey);
  let url;
  try {
    url = new URL(newAccountUrl);
  } catch {
    throw new Error("Invalid configured ACME newAccount endpoint");
  }
  if (
    typeof newAccountUrl !== "string" ||
    url.href !== newAccountUrl ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    typeof kid !== "string" ||
    kid.length < 1 ||
    kid.length > 512 ||
    /[^\x21-\x7e]/.test(kid) ||
    typeof hmacKey !== "string" ||
    hmacKey.length < 43 ||
    hmacKey.length > 171 ||
    !/^[A-Za-z0-9_-]+$/.test(hmacKey)
  )
    throw new Error("Invalid configured ACME external account binding");
  const secret = Buffer.from(hmacKey, "base64url");
  if (
    secret.length < 32 ||
    secret.length > 128 ||
    secret.toString("base64url") !== hmacKey
  ) {
    secret.fill(0);
    throw new Error("Invalid configured ACME external account binding");
  }
  try {
    const protectedHeader = Buffer.from(
      JSON.stringify({ alg: "HS256", kid, url: newAccountUrl }),
    ).toString("base64url");
    const payload = Buffer.from(JSON.stringify(key)).toString("base64url");
    const signature = createHmac("sha256", secret)
      .update(`${protectedHeader}.${payload}`)
      .digest("base64url");
    return Object.freeze({ protected: protectedHeader, payload, signature });
  } finally {
    secret.fill(0);
  }
}
