import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { connect } from "node:tls";
import { ciHostname } from "./standalone-fixture.mjs";

const knownCodes = new Set([
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ENOTFOUND",
  "ECONNREFUSED",
  "ECONNRESET",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const code = (error) => (knownCodes.has(error?.code) ? error.code : "OTHER");
function certificateKind(cert) {
  if (typeof cert?.subjectaltname !== "string") return "unavailable";
  const names = cert.subjectaltname.slice(0, 4096).split(", ");
  if (names.includes("DNS:" + ciHostname)) return "ci-fixture";
  if (names.includes("DNS:*.github.com") || names.includes("DNS:github.com"))
    return "github";
  return "other";
}
export function baselineFailureIdentity(error) {
  const codes = [];
  let certificate = "unavailable";
  for (let depth = 0; error && depth < 4; depth++, error = error.cause) {
    const value = code(error);
    if (value !== "OTHER" && !codes.includes(value)) codes.push(value);
    if (error.cert) certificate = certificateKind(error.cert);
  }
  return { codes, certificate };
}

async function addresses() {
  return await new Promise((resolve) => {
    execFile(
      "/usr/bin/getent",
      ["ahosts", "api.github.com"],
      {
        timeout: 2000,
        maxBuffer: 4096,
        encoding: "utf8",
      },
      (_error, stdout) =>
        resolve(
          [
            ...new Set(
              String(stdout ?? "")
                .split(/\r?\n/)
                .map((line) => line.trim().split(/\s+/)[0])
                .filter((value) => isIP(value)),
            ),
          ].slice(0, 4),
        ),
    );
  });
}
async function probe(address) {
  if (!isIP(address ?? "")) return { status: "dns-unavailable" };
  return await new Promise((resolve) => {
    const socket = connect({
      host: address,
      port: 443,
      servername: "api.github.com",
      rejectUnauthorized: true,
    });
    let finished = false;
    const finish = (error) => {
      if (finished) return;
      finished = true;
      globalThis.clearTimeout(timer);
      const certificate = error?.cert ?? socket.getPeerCertificate();
      const result = {
        status: error ? "failed" : "verified",
        address: isIP(socket.remoteAddress ?? "")
          ? socket.remoteAddress
          : address,
        code: error ? code(error) : null,
        certificate: certificateKind(certificate),
      };
      socket.destroy();
      resolve(result);
    };
    const timer = globalThis.setTimeout(
      () => finish({ code: "ETIMEDOUT" }),
      2000,
    );
    socket.once("secureConnect", () => finish());
    socket.once("error", finish);
  });
}

// Failure-only, at most ~4 seconds, no authenticated retry, headers, bodies,
// URL queries, arbitrary exception text or certificate dumps. A later probe is
// explicitly separate from the original failed connection.
export async function reportBaselineTransportFailure(error) {
  const resolved = await addresses();
  const hosts = await readFile("/etc/hosts", "utf8").catch(() => "");
  console.error(
    JSON.stringify({
      event: "release.baseline_transport_failed",
      original: baselineFailureIdentity(error),
      diagnosticProbe: {
        hostname: "api.github.com",
        addresses: resolved,
        tls: await probe(resolved[0]),
      },
      fixtureHostMapped: hosts
        .split(/\r?\n/)
        .some((line) =>
          line
            .split("#", 1)[0]
            .trim()
            .split(/\s+/)
            .slice(1)
            .includes(ciHostname),
        ),
    }),
  );
}
