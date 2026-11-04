import { createPublicKey } from "node:crypto";
import { request } from "node:https";
import { setTimeout, clearTimeout } from "node:timers";
import { URL } from "node:url";
import { validateLanHttpsProvider } from "../../packages/server-setup-core/src/lan-https.mjs";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";
import { createLanHttpsProof, lanHttpsPublicIdentity } from "./proof.mjs";
import { canonicalLanHttpsAcmePublicKey } from "./eab.mjs";

// Explicit adapter injection is for tests. The production transport always uses
// normal HTTPS trust, a deadline, bounded bodies and no redirects/proxy fallback.
export function requestLanHttpsAuthorityJson(
  url,
  { method, body, headers = {} },
) {
  if (
    !(url instanceof URL) ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash
  )
    return Promise.reject(new Error("Authority transport requires HTTPS"));
  return new Promise((resolve, reject) => {
    let completed = false;
    const finish = (error, result) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (error) reject(new Error("LAN HTTPS authority request failed"));
      else resolve(result);
    };
    const call = request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(body
            ? {
                "Content-Type": "application/json",
                "Content-Length": body.length,
              }
            : {}),
          ...headers,
        },
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
        agent: false,
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > 65536) {
            finish(new Error());
            call.destroy();
          } else chunks.push(chunk);
        });
        response.on("error", finish);
        response.on("end", () => {
          try {
            finish(null, {
              status: response.statusCode,
              body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
            });
          } catch {
            finish(new Error());
          }
        });
      },
    );
    const timer = setTimeout(() => {
      finish(new Error());
      call.destroy();
    }, 5000);
    call.on("error", finish);
    call.end(body);
  });
}

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid authority response");
  return value;
}

export function createLanHttpsAuthorityClient({
  provider,
  identityKey,
  transport = requestLanHttpsAuthorityJson,
}) {
  const checked = validateLanHttpsProvider(provider);
  const exported = createPublicKey(identityKey).export({ format: "jwk" });
  const identity = lanHttpsPublicIdentity({
    kty: exported.kty,
    crv: exported.crv,
    x: exported.x,
  });
  async function call(path, method = "GET", body, proof) {
    const result = await transport(new URL(path, checked.serverOrigin), {
      method,
      ...(body ? { body } : {}),
      ...(proof
        ? {
            headers: {
              "x-latex-renderer-lan-proof": Buffer.from(
                JSON.stringify(proof),
              ).toString("base64url"),
            },
          }
        : {}),
    });
    if (!result || result.status !== 200) {
      // Do not include provider response bodies, registration codes or URLs in
      // exceptions; callers can display a safe category and retry explicitly.
      const error = new Error("LAN HTTPS authority rejected the request");
      error.status = result?.status;
      throw error;
    }
    return object(result.body);
  }
  async function signed(path, value) {
    const body = Buffer.from(JSON.stringify(value));
    const challenge = await call(
      "/v1/nonce",
      "POST",
      Buffer.from(JSON.stringify({ publicKey: identity.publicKey })),
    );
    if (
      challenge.installationId !== identity.installationId ||
      typeof challenge.nonce !== "string"
    )
      throw new Error("Invalid authority nonce response");
    const proof = createLanHttpsProof(identityKey, {
      audience: checked.serverOrigin,
      path,
      nonce: challenge.nonce,
      body,
    });
    return call(path, "POST", body, proof);
  }
  async function metadata() {
    const value = await call("/.well-known/latex-renderer-lan-https");
    if (
      value.format !== 1 ||
      value.serverOrigin !== checked.serverOrigin ||
      value.lanDomain !== checked.lanDomain ||
      !["open", "invite"].includes(value.registration) ||
      value.proofAlgorithm !== "Ed25519" ||
      !Array.isArray(value.issuers) ||
      value.issuers.length > 4
    )
      throw new Error(
        "Authority metadata does not match the reviewed provider",
      );
    const ids = new Set();
    const issuers = value.issuers.map((input) => {
      const issuer = profileRecord(input, "public ACME issuer", [
        "id",
        "directoryUrl",
        "newAccountUrl",
      ]);
      const directory = new URL(issuer.directoryUrl),
        account = new URL(issuer.newAccountUrl);
      if (
        typeof issuer.id !== "string" ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(issuer.id) ||
        ids.has(issuer.id) ||
        directory.origin !== account.origin ||
        [directory, account].some(
          (url) =>
            url.protocol !== "https:" ||
            url.username ||
            url.password ||
            url.search ||
            url.hash,
        )
      )
        throw new Error("Invalid authority issuer metadata");
      ids.add(issuer.id);
      return Object.freeze({
        id: issuer.id,
        directoryUrl: directory.href,
        newAccountUrl: account.href,
      });
    });
    return Object.freeze({
      format: 1,
      serverOrigin: checked.serverOrigin,
      lanDomain: checked.lanDomain,
      registration: value.registration,
      proofAlgorithm: "Ed25519",
      issuers: Object.freeze(issuers),
    });
  }
  return Object.freeze({
    installationId: identity.installationId,
    publicKey: identity.publicKey,
    metadata,
    async enroll(invitationCode) {
      const value = await signed("/v1/enroll", {
        publicKey: identity.publicKey,
        ...(invitationCode === undefined ? {} : { invitationCode }),
      });
      if (
        value.installationId !== identity.installationId ||
        typeof value.created !== "boolean"
      )
        throw new Error("Invalid authority enrollment response");
      return Object.freeze({
        installationId: identity.installationId,
        created: value.created,
      });
    },
    async bindAcmeAccount(issuerId, publicKey) {
      const key = canonicalLanHttpsAcmePublicKey(publicKey);
      const policy = await metadata();
      const issuer = policy.issuers.find(
        (value) => value && value.id === issuerId,
      );
      if (
        !issuer ||
        typeof issuer.newAccountUrl !== "string" ||
        new URL(issuer.newAccountUrl).protocol !== "https:"
      )
        throw new Error("ACME issuer is not configured by this authority");
      const value = await signed("/v1/acme/bind", {
        issuer: issuerId,
        publicKey: key,
      });
      const binding = profileRecord(
        value.externalAccountBinding,
        "external account binding",
        ["protected", "payload", "signature"],
      );
      try {
        if (
          value.issuer !== issuerId ||
          Object.values(binding).some(
            (part) =>
              typeof part !== "string" ||
              part.length > 4096 ||
              !/^[A-Za-z0-9_-]+$/.test(part),
          )
        )
          throw new Error();
        const header = JSON.parse(
          Buffer.from(binding.protected, "base64url").toString(),
        );
        const payload = canonicalLanHttpsAcmePublicKey(
          JSON.parse(Buffer.from(binding.payload, "base64url").toString()),
        );
        if (
          header.alg !== "HS256" ||
          header.url !== issuer.newAccountUrl ||
          JSON.stringify(payload) !== JSON.stringify(key)
        )
          throw new Error();
      } catch {
        throw new Error("Authority returned a mismatched account binding");
      }
      return Object.freeze({ ...binding });
    },
    async presentChallenge(hostname, value) {
      const response = await signed("/v1/challenge/present", {
        hostname,
        value,
      });
      if (
        typeof response.id !== "string" ||
        !/^[0-9a-f]{32}$/.test(response.id) ||
        !Number.isSafeInteger(response.expiresAt)
      )
        throw new Error("Invalid authority challenge response");
      return Object.freeze({ id: response.id, expiresAt: response.expiresAt });
    },
    async removeChallenge(id) {
      const value = await signed("/v1/challenge/remove", { id });
      if (typeof value.removed !== "boolean")
        throw new Error("Invalid authority cleanup response");
      return Object.freeze({ removed: value.removed });
    },
  });
}
