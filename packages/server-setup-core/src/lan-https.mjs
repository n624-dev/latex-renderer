import { isIP } from "node:net";
import { URL } from "node:url";
import { profileRecord } from "./profile-shape.mjs";
import { serverIngressContainsAddress } from "./ingress-review.mjs";

const privateNetworks = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
];

// These functions only review data. They perform no discovery, DNS, TLS,
// certificate issuance, credential reads or changes to a running ingress.
export function normalizeLanHttpsDomain(value) {
  if (
    typeof value !== "string" ||
    value.length > 213 ||
    !value.includes(".") ||
    isIP(value) ||
    !value
      .split(".")
      .every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
      ) ||
    /^[0-9]+$/.test(value.split(".").at(-1))
  )
    throw new Error(
      "LAN HTTPS requires an ASCII DNS domain without a trailing dot",
    );
  return value.toLowerCase();
}

function privateAddress(value) {
  if (
    typeof value !== "string" ||
    value.includes("%") ||
    !isIP(value) ||
    !privateNetworks.some((network) =>
      serverIngressContainsAddress(network, value),
    )
  )
    throw new Error("LAN HTTPS requires a private IPv4 or IPv6 ULA address");
  if (isIP(value) === 4)
    return { address: value, label: value.replaceAll(".", "-") };
  const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
  const [head, tail] = canonical.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const words = canonical.includes("::")
    ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
    : left;
  // A full eight-word label also represents addresses ending in :: without
  // producing an invalid DNS label ending in a hyphen. No instance ID enters it.
  return {
    address: canonical,
    label: words.map((word) => word.padStart(4, "0")).join("-"),
  };
}

export function lanHttpsHostname(address, domain) {
  return `${privateAddress(address).label}.${normalizeLanHttpsDomain(domain)}`;
}

export function lanHttpsAddress(hostname, domain) {
  const suffix = `.${normalizeLanHttpsDomain(domain)}`;
  if (typeof hostname !== "string" || !hostname.toLowerCase().endsWith(suffix))
    throw new Error("LAN HTTPS name is outside the configured domain");
  const name = hostname.toLowerCase();
  const label = name.slice(0, -suffix.length);
  let address;
  if (/^(?:[0-9]+-){3}[0-9]+$/.test(label))
    address = label.replaceAll("-", ".");
  else if (/^(?:[0-9a-f]{4}-){7}[0-9a-f]{4}$/.test(label))
    address = label.replaceAll("-", ":");
  else
    throw new Error(
      "LAN HTTPS name must encode exactly one private IP address",
    );
  const checked = privateAddress(address);
  if (lanHttpsHostname(address, domain) !== name)
    throw new Error("LAN HTTPS name is not canonical");
  return checked.address;
}

export function lanHttpsOrigin(address, domain, port = 443) {
  if (
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (port >= 3100 && port <= 3199)
  )
    throw new Error(
      "LAN HTTPS port is invalid or reserved for internal services",
    );
  return `https://${lanHttpsHostname(address, domain)}${port === 443 ? "" : `:${port}`}`;
}

export function validateLanHttpsServerOrigin(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("LAN HTTPS server requires an exact HTTPS origin");
  }
  if (
    typeof value !== "string" ||
    value !== parsed.origin ||
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password
  )
    throw new Error("LAN HTTPS server requires an exact HTTPS origin");
  // Deliberately allow a custom administrator-controlled server on a private
  // address. Its certificate still has to pass the normal TLS trust checks.
  return parsed.origin;
}

export function validateLanHttpsProvider(input) {
  const model = profileRecord(input, "LAN HTTPS provider", [
    "format",
    "provider",
    "serverOrigin",
    "lanDomain",
    "address",
    "port",
    "keylessFallback",
    "publicOrigin",
  ]);
  if (
    model.format !== 1 ||
    !["akebi-keyless", "akebi-local-acme"].includes(model.provider) ||
    typeof model.keylessFallback !== "boolean" ||
    (model.provider === "akebi-keyless" && !model.keylessFallback)
  )
    throw new Error(
      "LAN HTTPS requires an explicit provider and fallback policy",
    );
  const serverOrigin = validateLanHttpsServerOrigin(model.serverOrigin);
  const lanDomain = normalizeLanHttpsDomain(model.lanDomain);
  const address = privateAddress(model.address).address;
  const port = model.port === undefined ? 443 : model.port;
  const publicOrigin = lanHttpsOrigin(address, lanDomain, port);
  if (
    Object.hasOwn(model, "publicOrigin") &&
    model.publicOrigin !== publicOrigin
  )
    throw new Error(
      "LAN HTTPS public origin must match the selected address and domain",
    );
  return Object.freeze({
    format: 1,
    provider: model.provider,
    serverOrigin,
    lanDomain,
    address,
    port,
    keylessFallback: model.keylessFallback,
    publicOrigin,
  });
}

export const LAN_HTTPS_AUTHORITY_DEFAULTS = Object.freeze({
  maxInstallations: 4096,
  maxNonces: 512,
  maxNoncesPerInstallation: 4,
  nonceTtlMs: 120_000,
  maxChallenges: 128,
  maxChallengesPerInstallation: 4,
  challengeTtlMs: 600_000,
  maxInvites: 256,
});

export function validateLanHttpsAuthorityPolicy(input) {
  const model = profileRecord(input, "LAN HTTPS authority policy", [
    "format",
    "serverOrigin",
    "lanDomain",
    "registration",
    "limits",
  ]);
  if (model.format !== 1 || !["open", "invite"].includes(model.registration))
    throw new Error(
      "LAN HTTPS authority must select open or invite registration",
    );
  const limits = profileRecord(
    model.limits ?? {},
    "LAN HTTPS authority limits",
    Object.keys(LAN_HTTPS_AUTHORITY_DEFAULTS),
  );
  const checked = { ...LAN_HTTPS_AUTHORITY_DEFAULTS, ...limits };
  for (const [name, value] of Object.entries(checked)) {
    const maximum = name.endsWith("TtlMs") ? 3_600_000 : 65_536;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error(
        "LAN HTTPS authority limits must be bounded positive integers",
      );
  }
  if (
    checked.maxNoncesPerInstallation > checked.maxNonces ||
    checked.maxChallengesPerInstallation > checked.maxChallenges
  )
    throw new Error("Per-installation limits must not exceed authority limits");
  return Object.freeze({
    format: 1,
    serverOrigin: validateLanHttpsServerOrigin(model.serverOrigin),
    lanDomain: normalizeLanHttpsDomain(model.lanDomain),
    registration: model.registration,
    limits: Object.freeze(checked),
  });
}
