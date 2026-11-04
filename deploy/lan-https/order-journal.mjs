import { createHash, createPublicKey, createPrivateKey } from "node:crypto";
import { URL } from "node:url";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";
import { validateLanHttpsProvider } from "../../packages/server-setup-core/src/lan-https.mjs";
import { lanHttpsManagementHostname } from "./authority-store.mjs";

function publicDigest(key) {
  return createHash("sha256")
    .update(
      createPublicKey(createPrivateKey(key)).export({
        type: "spki",
        format: "der",
      }),
    )
    .digest("hex");
}

export function checkedLanHttpsOrder(order, hostnames, accountUrl) {
  profileRecord(order, "ACME order", [
    "url",
    "status",
    "expires",
    "identifiers",
    "authorizations",
    "finalize",
    "certificate",
    "error",
    "notBefore",
    "notAfter",
    "replaces",
  ]);
  const origin = new URL(accountUrl).origin;
  function url(value) {
    if (typeof value !== "string" || value.length > 2048)
      throw new Error("Invalid ACME order URL");
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.href !== value
    )
      throw new Error("ACME order URL belongs to another authority");
    return value;
  }
  if (
    !Array.isArray(hostnames) ||
    hostnames.length !== 2 ||
    !Array.isArray(order.identifiers) ||
    order.identifiers.length !== 2 ||
    !["pending", "ready", "processing", "valid", "invalid"].includes(
      order.status,
    ) ||
    !Array.isArray(order.authorizations) ||
    order.authorizations.length > 2
  )
    throw new Error("Invalid ACME order shape");
  const names = order.identifiers.map((identifier) => {
    profileRecord(identifier, "ACME order identifier", ["type", "value"]);
    if (identifier.type !== "dns" || !hostnames.includes(identifier.value))
      throw new Error("ACME order changed its requested names");
    return identifier.value;
  });
  if (new Set(names).size !== 2) throw new Error("Duplicated ACME order name");
  const result = {
    url: url(order.url),
    status: order.status,
    identifiers: names.map((value) => ({ type: "dns", value })),
    authorizations: order.authorizations.map(url),
    finalize: url(order.finalize),
  };
  if (order.certificate !== undefined)
    result.certificate = url(order.certificate);
  if (order.expires !== undefined) {
    if (
      typeof order.expires !== "string" ||
      !Number.isSafeInteger(Date.parse(order.expires))
    )
      throw new Error("Invalid ACME order expiry");
    result.expires = order.expires;
  }
  return result;
}

// The caller must hold the installation's OS flock across journal and network
// operations. A single pending order is retained, never a growing order history.
export class LanHttpsOrderJournal {
  #state;
  #context;
  #hostnames;
  #accountUrl;
  constructor({
    state,
    provider,
    installationId,
    issuerId,
    directoryUrl,
    accountKey,
    tlsKey,
    accountUrl,
  }) {
    const checked = validateLanHttpsProvider(provider);
    if (
      checked.provider !== "akebi-local-acme" ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(issuerId)
    )
      throw new Error("Invalid ACME order context");
    const directory = new URL(directoryUrl),
      account = new URL(accountUrl);
    if (
      [directory, account].some(
        (v) =>
          v.protocol !== "https:" ||
          v.username ||
          v.password ||
          v.search ||
          v.hash,
      ) ||
      directory.origin !== account.origin
    )
      throw new Error("Invalid ACME order authority");
    this.#state = state;
    this.#hostnames = [
      new URL(checked.publicOrigin).hostname,
      lanHttpsManagementHostname(installationId, checked.lanDomain),
    ];
    this.#accountUrl = accountUrl;
    this.#context = createHash("sha256")
      .update(
        JSON.stringify([
          checked.serverOrigin,
          this.#hostnames,
          installationId,
          issuerId,
          directoryUrl,
          accountUrl,
          publicDigest(accountKey),
          publicDigest(tlsKey),
        ]),
      )
      .digest("hex");
  }
  load() {
    const bytes = this.#state.read("order.json", 32768);
    if (!bytes) return null;
    try {
      const record = JSON.parse(bytes.toString("utf8"));
      profileRecord(record, "saved ACME order", [
        "format",
        "context",
        "pending",
      ]);
      if (record.format !== 1 || !/^[0-9a-f]{64}$/.test(record.context))
        throw new Error();
      // A completed journal may be reused after an explicit configuration change.
      if (record.pending === null) return null;
      if (record.context !== this.#context) throw new Error();
      profileRecord(record.pending, "saved ACME order payload", [
        "order",
        "csr",
      ]);
      const csr = record.pending.csr;
      if (
        typeof csr !== "string" ||
        csr.length > 8192 ||
        Buffer.from(csr, "base64").toString("base64") !== csr
      )
        throw new Error();
      const decoded = Buffer.from(csr, "base64");
      if (
        !/^-----BEGIN CERTIFICATE REQUEST-----\n[\s\S]+\n-----END CERTIFICATE REQUEST-----\n?$/.test(
          decoded.toString("utf8"),
        )
      )
        throw new Error();
      return {
        order: checkedLanHttpsOrder(
          record.pending.order,
          this.#hostnames,
          this.#accountUrl,
        ),
        csr: decoded,
      };
    } catch {
      throw new Error(
        "Saved ACME order is invalid or belongs to different settings; state was retained",
      );
    }
  }
  save(order, csr) {
    if (
      !Buffer.isBuffer(csr) ||
      csr.length > 6144 ||
      !/^-----BEGIN CERTIFICATE REQUEST-----\n[\s\S]+\n-----END CERTIFICATE REQUEST-----\n?$/.test(
        csr.toString("utf8"),
      )
    )
      throw new Error("Invalid bounded ACME certificate request");
    const checked = checkedLanHttpsOrder(
      order,
      this.#hostnames,
      this.#accountUrl,
    );
    this.#state.saveProtocolRecord("order.json", {
      format: 1,
      context: this.#context,
      pending: { order: checked, csr: csr.toString("base64") },
    });
  }
  clear() {
    // Validate before clearing: a corrupt or differently configured order must
    // never be interpreted as an absent order and replaced by a new issuance.
    this.load();
    this.#state.saveProtocolRecord("order.json", {
      format: 1,
      context: this.#context,
      pending: null,
    });
  }
}
