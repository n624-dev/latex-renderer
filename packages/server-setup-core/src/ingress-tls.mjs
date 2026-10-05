import { createPrivateKey, X509Certificate } from "node:crypto";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { isIP } from "node:net";
import { createSecureContext } from "node:tls";
import { validateServerIngressReview } from "./ingress-review.mjs";

// Caller supplies authorized bytes. No file/provider access or key serialization.
export function validateServerIngressTls(
  input,
  certificate,
  privateKey,
  now = Date.now(),
) {
  const review = validateServerIngressReview(input);
  if (review.mode !== "standalone" || review.tlsProvider !== "custom")
    throw new Error("Custom TLS validation requires standalone/custom ingress");
  if (
    !Buffer.isBuffer(certificate) ||
    certificate.length < 1 ||
    certificate.length > 512 * 1024 ||
    !Buffer.isBuffer(privateKey) ||
    privateKey.length < 1 ||
    privateKey.length > 16 * 1024 ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw new Error("Invalid TLS material size or validation time");
  let leaf;
  try {
    const pem = certificate.toString("utf8");
    const blocks = pem.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    );
    if (
      !blocks ||
      blocks.length > 16 ||
      blocks.join("").replace(/\s/g, "") !== pem.replace(/\s/g, "")
    )
      throw new Error();
    const chain = blocks.map((block) => new X509Certificate(block));
    leaf = chain[0];
    if (
      chain.some(
        (cert) =>
          now < Date.parse(cert.validFrom) || now >= Date.parse(cert.validTo),
      )
    )
      throw new Error();
    if (leaf.ca || !leaf.checkPrivateKey(createPrivateKey(privateKey)))
      throw new Error();
    if (
      leaf.keyUsage &&
      !leaf.keyUsage.includes("1.3.6.1.5.5.7.3.1") &&
      !leaf.keyUsage.includes("2.5.29.37.0")
    )
      throw new Error();
    const hostname = new URL(review.publicOrigin).hostname.replace(
      /^\[|\]$/g,
      "",
    );
    const matches = isIP(hostname)
      ? leaf.checkIP(hostname)
      : leaf.checkHost(hostname, {
          subject: "never",
          partialWildcards: false,
          multiLabelWildcards: false,
        });
    if (!matches) throw new Error();
    for (let i = 1; i < chain.length; i++) {
      if (
        !chain[i].ca ||
        !chain[i - 1].checkIssued(chain[i]) ||
        !chain[i - 1].verify(chain[i].publicKey)
      )
        throw new Error();
    }
    createSecureContext({
      cert: certificate,
      key: privateKey,
      minVersion: "TLSv1.2",
    });
  } catch {
    // OpenSSL errors may contain supplied material; return only this safe error.
    throw new Error(
      "Custom TLS certificate/key failed parsing, validity, SAN, chain or key-pair validation",
    );
  }
  return Object.freeze({
    fingerprint256: leaf.fingerprint256,
    expiresAt: new Date(leaf.validTo).toISOString(),
    publicOrigin: review.publicOrigin,
  });
}
