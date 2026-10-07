import { request } from "node:https";
import { Buffer } from "node:buffer";
import { URL } from "node:url";
import { TextDecoder } from "node:util";

const MAXIMUM_BYTES = 64 * 1024;
const ERROR =
  "OIDC discovery failed; check provider HTTPS, exact issuer and support for code, PKCE S256, and client_secret_basic";

// No import-time environment, file or provider access. Issuer identity is never
// normalized: the configured value, discovery issuer and ID-token iss must agree.
export function serverOidcDiscoveryUrl(issuer) {
  httpsUrl(issuer, "OIDC issuer");
  const url = new URL(issuer);
  url.pathname = `${url.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
  return url.toString();
}

export function validateServerOidcMetadata(issuer, input) {
  serverOidcDiscoveryUrl(issuer);
  if (
    input === null ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.values(Object.getOwnPropertyDescriptors(input)).some(
      (d) => !Object.hasOwn(d, "value"),
    ) ||
    Object.getOwnPropertySymbols(input).length
  )
    throw new Error("OIDC discovery must be a plain JSON object");
  if (!Object.hasOwn(input, "issuer") || input.issuer !== issuer)
    throw new Error("OIDC discovery issuer does not exactly match OIDC_ISSUER");
  const supports = (key, expected, optional = false) => {
    if (!Object.hasOwn(input, key)) return optional;
    const value = input[key];
    if (
      !Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 64 ||
      value.length === 0
    )
      return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Reflect.ownKeys(value).some(
        (key) =>
          typeof key !== "string" ||
          (key !== "length" && !/^(?:0|[1-9]\d*)$/.test(key)),
      ) ||
      Object.values(descriptors).some((d) => !Object.hasOwn(d, "value"))
    )
      return false;
    for (let i = 0; i < value.length; i++)
      if (
        !Object.hasOwn(value, i) ||
        typeof value[i] !== "string" ||
        value[i].length > 128
      )
        return false;
    return Array.prototype.includes.call(value, expected);
  };
  if (
    !supports("response_types_supported", "code") ||
    !supports("code_challenge_methods_supported", "S256") ||
    !supports(
      "token_endpoint_auth_methods_supported",
      "client_secret_basic",
      true,
    )
  )
    throw new Error(
      "OIDC provider must support code, PKCE S256, and client_secret_basic",
    );
  const endpoint = (key, label) => {
    if (!Object.hasOwn(input, key))
      throw new Error(`${label} requires an HTTPS URL`);
    return httpsUrl(input[key], label);
  };
  // Providers may have other metadata; never propagate it into review/logs.
  return Object.freeze({
    issuer,
    authorization_endpoint: endpoint(
      "authorization_endpoint",
      "OIDC authorization endpoint",
    ),
    token_endpoint: endpoint("token_endpoint", "OIDC token endpoint"),
    jwks_uri: endpoint("jwks_uri", "OIDC JWKS endpoint"),
  });
}

export async function discoverServerOidcProvider(issuer, options = {}) {
  const url = serverOidcDiscoveryUrl(issuer);
  const timeoutMs = options.timeoutMs ?? 10_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10_000)
    throw new Error("OIDC discovery timeout must be between 1 and 10000 ms");
  const timeout = globalThis.AbortSignal.timeout(timeoutMs);
  const signal = options.signal
    ? globalThis.AbortSignal.any([timeout, options.signal])
    : timeout;
  let reader;
  try {
    signal.throwIfAborted();
    const response = await withAbort(
      (options.fetchImpl ?? secureMetadataFetch)(url, {
        headers: { Accept: "application/json" },
        redirect: "error",
        signal,
      }),
      signal,
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new Error(ERROR);
    }
    if (!response.body) throw new Error(ERROR);
    reader = response.body.getReader();
    const declared = response.headers.get("content-length");
    if (
      declared !== null &&
      (!/^\d+$/.test(declared) || Number(declared) > MAXIMUM_BYTES)
    )
      throw new Error(ERROR);
    const chunks = [];
    let length = 0;
    for (;;) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      length += value.byteLength;
      if (length > MAXIMUM_BYTES) throw new Error(ERROR);
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return validateServerOidcMetadata(issuer, JSON.parse(text));
  } catch {
    // No provider error, response body, credentials or supplied URL in logs.
    throw new Error(ERROR);
  } finally {
    if (reader) {
      // Do not await a misbehaving injected transport's cancellation forever.
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

function httpsUrl(value, label) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 2048 ||
    /[\s\\]/u.test(value) ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f,
    )
  )
    throw new Error(`${label} must be an exact HTTPS URL`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an exact HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      `${label} must be an HTTPS URL without credentials, query, or fragment`,
    );
  return url.toString();
}

function withAbort(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error(ERROR));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}

// Default transport enforces normal CA/hostname verification even when a caller
// launched Node with NODE_TLS_REJECT_UNAUTHORIZED=0. No redirect or endpoint GETs.
function secureMetadataFetch(url, { signal, headers }) {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        headers,
        signal,
        agent: false,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      },
      (response) => {
        const status = response.statusCode ?? 500;
        if (status < 200 || status > 599) {
          response.destroy();
          reject(new Error(ERROR));
          return;
        }
        if (status < 200 || status >= 300) {
          response.destroy();
          resolve(new globalThis.Response(null, { status }));
          return;
        }
        let length = 0;
        const chunks = [];
        response.on("data", (chunk) => {
          length += chunk.length;
          if (length > MAXIMUM_BYTES) {
            response.destroy();
            req.destroy(new Error(ERROR));
          } else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("aborted", () => reject(new Error(ERROR)));
        response.on("end", () =>
          resolve(
            new globalThis.Response(
              [204, 205].includes(status) ? null : Buffer.concat(chunks),
              {
                status,
                headers: { "content-length": String(length) },
              },
            ),
          ),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
