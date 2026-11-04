import { X509Certificate, randomInt } from "node:crypto";
import { URL } from "node:url";
import { requestLanHttpsAuthorityJson } from "./authority-client.mjs";

function item(data, offset, end = data.length) {
  if (offset + 2 > end) throw new Error("Invalid DER item");
  const tag = data[offset++];
  let length = data[offset++];
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count < 1 || count > 4 || offset + count > end)
      throw new Error("Invalid DER length");
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + data[offset++];
  }
  if (offset + length > end) throw new Error("Invalid DER bounds");
  return { tag, start: offset, end: offset + length };
}

// RFC 9773's identifier uses the actual Authority Key Identifier extension,
// never an inferred hash of a CA public key. OpenSSL parses the certificate
// first; this bounded walk only extracts AKI and the unsigned serial bytes.
export function lanHttpsAcmeCertificateId(certificate) {
  const data = new X509Certificate(certificate).raw;
  if (data.length > 512 * 1024) throw new Error("Certificate is too large");
  const outer = item(data, 0),
    tbs = item(data, outer.start, outer.end);
  if (outer.tag !== 0x30 || tbs.tag !== 0x30)
    throw new Error("Invalid certificate DER");
  let serial = item(data, tbs.start, tbs.end);
  if (serial.tag === 0xa0) serial = item(data, serial.end, tbs.end);
  if (serial.tag !== 2 || serial.start === serial.end)
    throw new Error("Invalid certificate serial");
  let serialBytes = data.subarray(serial.start, serial.end);
  if (serialBytes[0] & 0x80) throw new Error("Negative certificate serial");
  while (serialBytes.length > 1 && serialBytes[0] === 0)
    serialBytes = serialBytes.subarray(1);
  let aki = null;
  for (let offset = serial.end; offset < tbs.end;) {
    const field = item(data, offset, tbs.end);
    offset = field.end;
    if (field.tag !== 0xa3) continue;
    const sequence = item(data, field.start, field.end);
    for (
      let extensionOffset = sequence.start;
      extensionOffset < sequence.end;
    ) {
      const extension = item(data, extensionOffset, sequence.end);
      extensionOffset = extension.end;
      const oid = item(data, extension.start, extension.end);
      if (
        oid.tag !== 6 ||
        data.subarray(oid.start, oid.end).toString("hex") !== "551d23"
      )
        continue;
      let value = item(data, oid.end, extension.end);
      if (value.tag === 1) value = item(data, value.end, extension.end);
      if (value.tag !== 4) throw new Error("Invalid Authority Key Identifier");
      const keySequence = item(data, value.start, value.end);
      for (let keyOffset = keySequence.start; keyOffset < keySequence.end;) {
        const key = item(data, keyOffset, keySequence.end);
        keyOffset = key.end;
        if (key.tag === 0x80) aki = data.subarray(key.start, key.end);
      }
    }
  }
  if (!aki || aki.length < 1 || aki.length > 64) return null;
  return `${aki.toString("base64url")}.${serialBytes.toString("base64url")}`;
}

function httpsEndpoint(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid ACME renewal endpoint");
  return url;
}

export async function planLanHttpsRenewal({
  certificate,
  directoryUrl,
  now = Date.now(),
  random = randomInt,
  transport = requestLanHttpsAuthorityJson,
}) {
  const leaf = new X509Certificate(certificate);
  const from = Date.parse(leaf.validFrom),
    expires = Date.parse(leaf.validTo);
  if (
    !Number.isSafeInteger(now) ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(expires) ||
    from >= expires
  )
    throw new Error("Invalid certificate renewal time");
  const fallback = Object.freeze({
    ari: false,
    renewAt: Math.max(now, Math.floor(from + ((expires - from) * 2) / 3)),
    certificateId: null,
  });
  const identifier = lanHttpsAcmeCertificateId(certificate);
  if (!identifier) return fallback;
  try {
    const directory = await transport(httpsEndpoint(directoryUrl), {
      method: "GET",
    });
    if (
      directory.status !== 200 ||
      typeof directory.body?.renewalInfo !== "string"
    )
      return fallback;
    const endpoint = httpsEndpoint(directory.body.renewalInfo);
    // ARI may legitimately use a different HTTPS host (ZeroSSL does). This GET
    // transport sends no ACME signature, EAB, private key or account credential.
    endpoint.pathname = endpoint.pathname.replace(/\/$/, "") + "/" + identifier;
    const result = await transport(endpoint, { method: "GET" });
    const start = Date.parse(result.body?.suggestedWindow?.start),
      end = Date.parse(result.body?.suggestedWindow?.end);
    if (
      result.status !== 200 ||
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start >= end ||
      end - start > 365 * 86400000 ||
      start >= expires
    )
      return fallback;
    const earliest = Math.max(now, start),
      latest = Math.min(end, expires);
    const width = Math.max(1, latest - earliest);
    const offset = random(width);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= width)
      return fallback;
    return Object.freeze({
      ari: true,
      renewAt: earliest + offset,
      certificateId: identifier,
    });
  } catch {
    return fallback;
  }
}
