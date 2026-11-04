import { isIP } from "node:net";
import { URL } from "node:url";
import { setTimeout, clearTimeout } from "node:timers";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";
import { createLanHttpsRateLimit } from "./rate-limit.mjs";
import { LanHttpsAuthorityError } from "./authority-store.mjs";

function configuredIssuer(input) {
  const model = profileRecord(input, "configured LAN HTTPS issuer", [
    "id",
    "directoryUrl",
    "newAccountUrl",
    "kid",
    "hmacKey",
  ]);
  const directory = new URL(model.directoryUrl),
    account = new URL(model.newAccountUrl);
  const noEab = model.kid === null && model.hmacKey === null;
  if (
    typeof model.id !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(model.id) ||
    [directory, account].some(
      (url) =>
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.search ||
        url.hash,
    ) ||
    directory.origin !== account.origin ||
    directory.href !== model.directoryUrl ||
    account.href !== model.newAccountUrl ||
    (!noEab &&
      (typeof model.kid !== "string" ||
        model.kid.length < 1 ||
        model.kid.length > 512 ||
        /[^\x21-\x7e]/.test(model.kid) ||
        typeof model.hmacKey !== "string" ||
        !/^[A-Za-z0-9_-]{43,171}$/.test(model.hmacKey) ||
        Buffer.from(model.hmacKey, "base64url").length < 32 ||
        Buffer.from(model.hmacKey, "base64url").length > 128 ||
        Buffer.from(model.hmacKey, "base64url").toString("base64url") !==
          model.hmacKey))
  )
    throw new Error("Invalid authority-owned ACME issuer configuration");
  return Object.freeze({ ...model });
}

function publicJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    ...(status === 429 ? { "Retry-After": "60" } : {}),
  });
  response.end(body);
}

function jsonObject(body) {
  try {
    const value = JSON.parse(body.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new LanHttpsAuthorityError("invalid_request", 400);
  }
}

function requestProof(request) {
  const value = request.headers["x-latex-renderer-lan-proof"];
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9_-]{1,1024}$/.test(value) ||
    Buffer.from(value, "base64url").toString("base64url") !== value
  )
    throw new LanHttpsAuthorityError("authentication_rejected", 401);
  const proof = jsonObject(Buffer.from(value, "base64url"));
  profileRecord(proof, "LAN HTTPS request proof", [
    "installationId",
    "nonce",
    "signature",
  ]);
  return proof;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0,
      finished = false;
    const timer = setTimeout(
      () => end(new LanHttpsAuthorityError("request_timeout", 408)),
      5000,
    );
    const end = (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      request.off("data", data);
      request.off("end", completed);
      if (error) {
        request.pause();
        reject(error);
      } else resolve(Buffer.concat(chunks));
    };
    const data = (chunk) => {
      size += chunk.length;
      if (size > 65536)
        return end(new LanHttpsAuthorityError("request_too_large", 413));
      chunks.push(chunk);
    };
    const completed = () => end();
    request.on("data", data);
    request.once("end", completed);
    request.once("error", () =>
      end(new LanHttpsAuthorityError("request_aborted", 400)),
    );
    request.once("aborted", () =>
      end(new LanHttpsAuthorityError("request_aborted", 400)),
    );
  });
}

// This is the PUBLIC authority API, separate from the renderer/admin APIs.
// Deploy behind a TLS ingress that overwrites Host and, if explicitly enabled,
// the trusted client-address header. Administrative invite/revoke operations
// intentionally have no HTTP routes.
export function createLanHttpsAuthorityHandler({
  store,
  issuers = [],
  trustLoopbackProxy = false,
  requestLimit = createLanHttpsRateLimit(),
  registrationLimit = createLanHttpsRateLimit({
    requestsPerKey: 20,
    requestsTotal: 256,
    windowMs: 3_600_000,
  }),
  maxConcurrentRequests = 8,
  signer,
  signingLimit = createLanHttpsRateLimit({
    requestsPerKey: 60,
    requestsTotal: 600,
    windowMs: 60000,
  }),
}) {
  if (
    !Array.isArray(issuers) ||
    issuers.length > 4 ||
    !Number.isSafeInteger(maxConcurrentRequests) ||
    maxConcurrentRequests < 1 ||
    maxConcurrentRequests > 64
  )
    throw new Error(
      "Authority HTTP configuration must have bounded issuers and concurrency",
    );
  const byIssuer = new Map();
  for (const input of issuers) {
    const issuer = configuredIssuer(input);
    if (byIssuer.has(issuer.id)) throw new Error("Duplicate authority issuer");
    byIssuer.set(issuer.id, issuer);
  }
  const origin = new URL(store.policy.serverOrigin);
  const metadata = Object.freeze({
    format: 1,
    serverOrigin: store.policy.serverOrigin,
    lanDomain: store.policy.lanDomain,
    registration: store.policy.registration,
    proofAlgorithm: "Ed25519",
    nonceTtlMs: store.policy.limits.nonceTtlMs,
    issuers: [...byIssuer.values()].map(
      ({ id, directoryUrl, newAccountUrl, kid }) => ({
        id,
        directoryUrl,
        newAccountUrl,
        ...(kid === null ? { externalAccountRequired: false } : {}),
      }),
    ),
  });
  const paths = new Set([
    "/v1/nonce",
    "/v1/enroll",
    "/v1/acme/bind",
    "/v1/keyless/certificate",
    "/v1/keyless/sign",
    "/v1/challenge/present",
    "/v1/challenge/remove",
  ]);
  let active = 0;
  async function handle(request, response) {
    if (request.headers.host !== origin.host)
      throw new LanHttpsAuthorityError("origin_mismatch", 421);
    let peer = request.socket.remoteAddress;
    if (!peer || !isIP(peer))
      throw new LanHttpsAuthorityError("invalid_peer", 400);
    if (
      trustLoopbackProxy &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(peer)
    ) {
      const forwarded = request.headers["x-latex-renderer-client-ip"];
      if (typeof forwarded !== "string" || !isIP(forwarded))
        throw new LanHttpsAuthorityError("invalid_proxy_peer", 400);
      peer = forwarded;
    }
    if (!requestLimit.allow(peer))
      throw new LanHttpsAuthorityError("request_rate_limit", 429);
    if (
      request.url === "/.well-known/latex-renderer-lan-https" &&
      request.method === "GET"
    )
      return publicJson(response, 200, metadata);
    if (!paths.has(request.url))
      throw new LanHttpsAuthorityError("not_found", 404);
    if (request.method !== "POST")
      throw new LanHttpsAuthorityError("method_not_allowed", 405);
    if (
      typeof request.headers["content-type"] !== "string" ||
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(
        request.headers["content-type"],
      )
    )
      throw new LanHttpsAuthorityError("json_required", 415);
    const length = request.headers["content-length"];
    if (
      length !== undefined &&
      (typeof length !== "string" ||
        !/^(?:0|[1-9][0-9]{0,5})$/.test(length) ||
        Number(length) > 65536)
    )
      throw new LanHttpsAuthorityError("request_too_large", 413);
    if (request.url === "/v1/enroll" && !registrationLimit.allow(peer))
      throw new LanHttpsAuthorityError("registration_rate_limit", 429);
    const proof = request.url === "/v1/nonce" ? null : requestProof(request);
    const body = await readBody(request);
    let result;
    switch (request.url) {
      case "/v1/keyless/certificate":
      case "/v1/keyless/sign": {
        if (!signer)
          throw new LanHttpsAuthorityError("keyless_unavailable", 503);
        const signing = request.url === "/v1/keyless/sign";
        const approved = store.authorizeKeyless(body, proof, signing);
        if (!signingLimit.allow(proof.installationId))
          throw new LanHttpsAuthorityError("keyless_rate_limit", 429);
        try {
          result = signing
            ? await signer.sign(approved.keyId, approved.digest)
            : await signer.certificate();
        } catch {
          throw new LanHttpsAuthorityError("keyless_unavailable", 503);
        }
        break;
      }
      case "/v1/nonce": {
        const input = profileRecord(jsonObject(body), "nonce request", [
          "publicKey",
        ]);
        result = store.issueNonce(input.publicKey);
        break;
      }
      case "/v1/enroll":
        result = store.enroll(body, proof);
        break;
      case "/v1/challenge/present":
        result = store.presentChallenge(body, proof);
        break;
      case "/v1/challenge/remove":
        result = store.removeChallenge(body, proof);
        break;
      case "/v1/acme/bind": {
        const input = jsonObject(body),
          issuer = byIssuer.get(input.issuer);
        if (!issuer)
          throw new LanHttpsAuthorityError("issuer_not_configured", 400);
        result = store.bindAcmeAccount(body, proof, issuer);
        break;
      }
    }
    publicJson(response, 200, result);
  }
  return (request, response) => {
    if (active >= maxConcurrentRequests) {
      response.setHeader("Connection", "close");
      publicJson(response, 503, { error: "authority_busy" });
      return;
    }
    active++;
    // The body-read deadline is part of this counter: slow uploads cannot
    // create an unbounded collection of pending promises or retained buffers.
    void handle(request, response)
      .catch((error) => {
        if (response.destroyed || response.headersSent) return;
        const known = error instanceof LanHttpsAuthorityError;
        response.setHeader("Connection", "close");
        // Never return SQLite, OpenSSL, request data or configured secret values.
        const databaseFailure = error?.code === "ERR_SQLITE_ERROR";
        publicJson(
          response,
          known ? error.status : databaseFailure ? 503 : 400,
          {
            error: known
              ? error.code
              : databaseFailure
                ? "authority_unavailable"
                : "invalid_request",
          },
        );
        response.once("finish", () => request.destroy());
      })
      .finally(() => {
        active--;
      });
  };
}
