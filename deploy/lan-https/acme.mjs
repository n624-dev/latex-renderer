import {
  createPrivateKey,
  createPublicKey,
  X509Certificate,
} from "node:crypto";
import { getCACertificates, createServer, connect } from "node:tls";
import { setTimeout, clearTimeout } from "node:timers";
import { URL } from "node:url";
import { Agent } from "node:https";
import { validateLanHttpsProvider } from "../../packages/server-setup-core/src/lan-https.mjs";
import { canonicalLanHttpsAcmePublicKey } from "./eab.mjs";
import { lanHttpsManagementHostname } from "./authority-store.mjs";
import { checkedLanHttpsOrder } from "./order-journal.mjs";

const caOrigins = new Set();
let transportConfigured = false;
let acmeModule;
async function loadAcme() {
  acmeModule ??= import("acme-client");
  return (await acmeModule).default;
}

function endpoint(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.href !== value
  )
    throw new Error("ACME requires a configured exact HTTPS endpoint");
  return url;
}

export async function createLanHttpsAcmeSession({
  directoryUrl,
  accountKey,
  accountUrl,
}) {
  const directory = endpoint(directoryUrl);
  const key = createPrivateKey(accountKey);
  canonicalLanHttpsAcmePublicKey(
    createPublicKey(key).export({ format: "jwk" }),
  );
  if (accountUrl && endpoint(accountUrl).origin !== directory.origin)
    throw new Error("Stored ACME account belongs to another authority");
  if (!caOrigins.has(directory.origin) && caOrigins.size >= 4)
    throw new Error("Too many configured ACME authorities in one process");
  caOrigins.add(directory.origin);
  const acme = await loadAcme();
  if (!transportConfigured) {
    // The pinned library owns this Axios instance. These limits affect only
    // ACME, not other application HTTP clients. In particular, a 429 with a
    // days-long Retry-After must leave scheduling to the agent, not sleep here.
    Object.assign(acme.axios.defaults, {
      timeout: 15_000,
      maxRedirects: 0,
      maxContentLength: 512 * 1024,
      maxBodyLength: 64 * 1024,
      proxy: false,
      httpsAgent: new Agent({
        rejectUnauthorized: true,
        minVersion: "TLSv1.2",
        keepAlive: false,
        maxSockets: 2,
        maxFreeSockets: 0,
      }),
    });
    acme.axios.defaults.acmeSettings.retryMaxAttempts = 0;
    acme.axios.interceptors.request.use((config) => {
      const deadline = globalThis.AbortSignal.timeout(15_000);
      config.signal = config.signal
        ? globalThis.AbortSignal.any([config.signal, deadline])
        : deadline;
      const target = endpoint(config.url);
      if (!caOrigins.has(target.origin))
        throw new Error("ACME response linked an unconfigured authority");
      return config;
    });
    acme.axios.interceptors.response.use((response) => {
      const retry = response.headers["retry-after"];
      if (
        response.status === 429 ||
        response.status >= 500 ||
        (response.status >= 400 && typeof retry === "string")
      ) {
        // The pinned client's API layer converts non-success responses into
        // plain Error objects, discarding Retry-After. Preserve only this
        // bounded scheduling header before that conversion; never retain or
        // expose the provider's response body, request JWS or account URL.
        const error = new Error("ACME authority deferred the operation");
        error.response = {
          status: response.status,
          headers:
            typeof retry === "string" && retry.length <= 256
              ? { "retry-after": retry }
              : {},
        };
        throw error;
      }
      return response;
    });
    transportConfigured = true;
  }
  return new acme.Client({
    directoryUrl,
    accountKey,
    ...(accountUrl ? { accountUrl } : {}),
    backoffAttempts: 10,
    backoffMin: 5000,
    backoffMax: 30000,
  });
}

export async function createLanHttpsCertificateRequest({
  provider,
  installationId,
  privateKey,
}) {
  const checked = validateLanHttpsProvider(provider);
  const hostname = new URL(checked.publicOrigin).hostname;
  const management = lanHttpsManagementHostname(
    installationId,
    checked.lanDomain,
  );
  const key = createPrivateKey(privateKey);
  canonicalLanHttpsAcmePublicKey(
    createPublicKey(key).export({ format: "jwk" }),
  );
  const acme = await loadAcme();
  const [, csr] = await acme.crypto.createCsr(
    { altNames: [hostname, management] },
    privateKey,
  );
  return Object.freeze({
    csr,
    hostnames: Object.freeze([hostname, management]),
  });
}

async function verifyChainWithTls(
  certificate,
  privateKey,
  hostname,
  trustedCertificates,
) {
  const server = createServer({
    cert: certificate,
    key: privateKey,
    minVersion: "TLSv1.2",
  });
  const sockets = new Set();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("tlsClientError", () => {});
  let client;
  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    await new Promise((resolve, reject) => {
      client = connect({
        host: "127.0.0.1",
        port: server.address().port,
        servername: hostname,
        ca: trustedCertificates,
        minVersion: "TLSv1.2",
        rejectUnauthorized: true,
      });
      const timer = setTimeout(() => {
        client.destroy();
        reject(new Error("Local certificate verification deadline"));
      }, 3000);
      client.once("secureConnect", () => {
        clearTimeout(timer);
        resolve();
      });
      client.once("error", () => {
        clearTimeout(timer);
        reject(new Error("Local certificate trust verification failed"));
      });
    });
  } finally {
    client?.destroy();
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  }
}

export async function validateLanHttpsIssuedCertificate({
  certificate,
  privateKey,
  hostnames,
  now = Date.now(),
  trustedCertificates = getCACertificates("default"),
  purpose = "installation",
}) {
  if (
    typeof certificate !== "string" ||
    Buffer.byteLength(certificate) > 512 * 1024 ||
    !Array.isArray(hostnames) ||
    !(
      (purpose === "installation" && hostnames.length === 2) ||
      (purpose === "keyless-operator" &&
        hostnames.length === 1 &&
        /^\*\.[a-z0-9.-]+$/.test(hostnames[0]))
    ) ||
    !Number.isSafeInteger(now)
  )
    throw new Error("Invalid LAN HTTPS certificate validation input");
  try {
    const blocks = certificate.match(
      /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g,
    );
    if (
      !blocks ||
      blocks.length > 16 ||
      blocks.join("").replace(/\s/g, "") !== certificate.replace(/\s/g, "")
    )
      throw new Error();
    const chain = blocks.map((block) => new X509Certificate(block));
    const leaf = chain[0];
    if (
      leaf.ca ||
      !leaf.checkPrivateKey(createPrivateKey(privateKey)) ||
      (leaf.keyUsage && !leaf.keyUsage.includes("1.3.6.1.5.5.7.3.1"))
    )
      throw new Error();
    const entries = leaf.subjectAltName?.split(", ") ?? [];
    if (entries.some((entry) => !entry.startsWith("DNS:"))) throw new Error();
    const names = entries.map((entry) => entry.slice(4));
    if (
      names.length !== hostnames.length ||
      new Set(names).size !== names.length ||
      names.some((name) => !hostnames.includes(name)) ||
      hostnames.some(
        (name) =>
          !leaf.checkHost(
            purpose === "keyless-operator"
              ? name.replace(/^\*\./, "keyless-check.")
              : name,
            { subject: "never", wildcards: purpose === "keyless-operator" },
          ),
      )
    )
      throw new Error();
    for (let i = 0; i < chain.length; i++) {
      if (
        now < Date.parse(chain[i].validFrom) ||
        now >= Date.parse(chain[i].validTo)
      )
        throw new Error();
      if (
        i &&
        (!chain[i].ca ||
          !chain[i - 1].checkIssued(chain[i]) ||
          !chain[i - 1].verify(chain[i].publicKey))
      )
        throw new Error();
    }
    // Exercise OpenSSL's actual TLS path validation (including constraints and
    // critical extensions) rather than treating signature checks as a complete
    // trust decision. This is one bounded loopback handshake before installation.
    await verifyChainWithTls(
      certificate,
      privateKey,
      purpose === "keyless-operator"
        ? hostnames[0].replace(/^\*\./, "keyless-check.")
        : hostnames[0],
      trustedCertificates,
    );
    return Object.freeze({
      fingerprint256: leaf.fingerprint256,
      expiresAt: new Date(leaf.validTo).toISOString(),
    });
  } catch {
    throw new Error(
      "Issued certificate failed trust, name, validity or key verification",
    );
  }
}

export class LanHttpsIssuanceError extends Error {
  constructor(cleanupPending, retryAt = null, orderTerminal = false) {
    super(
      "LAN HTTPS certificate issuance failed; existing certificate was retained",
    );
    this.name = "LanHttpsIssuanceError";
    this.cleanupPending = Object.freeze([...cleanupPending]);
    this.retryAt = retryAt;
    this.orderTerminal = orderTerminal;
  }
}

export async function issueLanHttpsCertificate({
  provider,
  authority,
  client,
  issuerId,
  accountKey,
  tlsKey,
  termsAccepted,
  saveAccount,
  replaces,
  journal,
  now = Date.now,
  verifyCertificate = validateLanHttpsIssuedCertificate,
}) {
  if (termsAccepted !== true || typeof saveAccount !== "function")
    throw new Error(
      "ACME terms acceptance and durable account persistence are required",
    );
  const checked = validateLanHttpsProvider(provider);
  if (checked.provider !== "akebi-local-acme")
    throw new Error("Local issuance requires the local ACME provider");
  const request = await createLanHttpsCertificateRequest({
    provider: checked,
    installationId: authority.installationId,
    privateKey: tlsKey,
  });
  const cleanupPending = [];
  let orderTerminal = false;
  try {
    let accountUrl;
    try {
      accountUrl = client.getAccountUrl();
    } catch {
      /* A new account needs a key-bound EAB. */
    }
    if (!accountUrl) {
      const publicKey = canonicalLanHttpsAcmePublicKey(
        createPublicKey(createPrivateKey(accountKey)).export({ format: "jwk" }),
      );
      const binding = await authority.bindAcmeAccount(issuerId, publicKey);
      await client.createAccount({
        termsOfServiceAgreed: true,
        ...(binding ? { externalAccountBinding: binding } : {}),
      });
      accountUrl = client.getAccountUrl();
      // Do not place orders before the newly registered account can survive a
      // restart. The private account key must already be persisted by caller.
      await saveAccount(accountUrl);
    }
    if (
      replaces !== undefined &&
      (typeof replaces !== "string" ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(replaces))
    )
      throw new Error();
    const saved = journal?.load();
    let csr = request.csr;
    let order;
    if (saved) {
      // Refresh the exact saved order with POST-as-GET. Never create another
      // order merely because a process or the network stopped after finalize.
      csr = saved.csr;
      const local = checkedLanHttpsOrder(
        saved.order,
        request.hostnames,
        accountUrl,
      );
      order = checkedLanHttpsOrder(
        await client.getOrder(local),
        request.hostnames,
        accountUrl,
      );
      if (order.url !== local.url) throw new Error("ACME order URL changed");
    } else {
      order = checkedLanHttpsOrder(
        await client.createOrder({
          identifiers: request.hostnames.map((value) => ({
            type: "dns",
            value,
          })),
          ...(replaces ? { replaces } : {}),
        }),
        request.hostnames,
        accountUrl,
      );
    }
    journal?.save(order, csr);
    if (
      order.status === "invalid" ||
      (["pending", "ready"].includes(order.status) &&
        order.expires &&
        Date.parse(order.expires) <= now())
    ) {
      orderTerminal = true;
      throw new Error("ACME order cannot be resumed");
    }
    if (order.status === "pending") {
      const authorizations = await client.getAuthorizations(order);
      if (
        !Array.isArray(authorizations) ||
        authorizations.length !== request.hostnames.length ||
        new Set(authorizations.map((a) => a.identifier.value)).size !==
          request.hostnames.length
      )
        throw new Error();
      // Two names are processed in order. No concurrent writers or an unbounded
      // Promise.all over an authority-supplied list of authorizations.
      for (const authorization of authorizations) {
        if (
          authorization.identifier.type !== "dns" ||
          authorization.wildcard ||
          !request.hostnames.includes(authorization.identifier.value)
        )
          throw new Error();
        if (authorization.status === "valid") continue;
        if (
          authorization.status !== "pending" ||
          !Array.isArray(authorization.challenges)
        )
          throw new Error();
        const challenge = authorization.challenges.find(
          (value) => value.type === "dns-01",
        );
        if (
          !challenge ||
          !["pending", "processing", "valid"].includes(challenge.status)
        )
          throw new Error();
        if (challenge.status === "valid") {
          await client.waitForValidStatus(authorization);
          continue;
        }
        const value = await client.getChallengeKeyAuthorization(challenge);
        const pending = await authority.presentChallenge(
          authorization.identifier.value,
          value,
        );
        try {
          if (
            (await client.verifyChallenge(authorization, challenge)) === false
          )
            throw new Error();
          if (challenge.status === "pending")
            await client.completeChallenge(challenge);
          await client.waitForValidStatus(challenge);
        } finally {
          try {
            await authority.removeChallenge(pending.id);
          } catch {
            cleanupPending.push(pending.id);
          }
        }
      }
      const refreshed = checkedLanHttpsOrder(
        await client.getOrder(order),
        request.hostnames,
        accountUrl,
      );
      if (refreshed.url !== order.url)
        throw new Error("ACME order URL changed");
      order = refreshed;
      journal?.save(order, csr);
    }
    if (order.status === "ready") {
      const finalized = checkedLanHttpsOrder(
        await client.finalizeOrder(order, csr),
        request.hostnames,
        accountUrl,
      );
      if (finalized.url !== order.url)
        throw new Error("ACME order URL changed");
      order = finalized;
      journal?.save(order, csr);
    }
    if (!["processing", "valid"].includes(order.status)) {
      orderTerminal = order.status === "invalid";
      throw new Error("ACME order is not ready for a certificate");
    }
    const certificate = await client.getCertificate(order);
    const verified = await verifyCertificate({
      certificate,
      privateKey: tlsKey,
      hostnames: request.hostnames,
      now: now(),
    });
    return Object.freeze({
      certificate,
      accountUrl,
      ...verified,
      cleanupPending: Object.freeze(cleanupPending),
    });
  } catch (error) {
    let retryAt = null;
    // Never sleep for provider Retry-After inside an HTTP retry loop. Persist
    // it in the outer scheduler for every CA stage, including account/finalize.
    const retry = error?.response?.headers?.["retry-after"];
    if (typeof retry === "string") {
      const time = /^\d{1,9}$/.test(retry)
        ? now() + Number(retry) * 1000
        : Date.parse(retry);
      if (Number.isSafeInteger(time) && time > now()) retryAt = time;
    }
    throw new LanHttpsIssuanceError(cleanupPending, retryAt, orderTerminal);
  }
}
