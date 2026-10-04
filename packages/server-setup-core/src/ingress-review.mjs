import { isIP } from "node:net";
import { URL } from "node:url";
import {
  profileRecord as record,
  profileText as text,
} from "./profile-shape.mjs";

export const INGRESS_PROFILE_KEYS = Object.freeze([
  "INGRESS_ACCESS_SCOPE",
  "INGRESS_TLS_PROVIDER",
  "INGRESS_LISTEN_ADDRESS",
  "INGRESS_LAN_NETWORKS",
]);

// No interface discovery, certificate reads, provider calls or inferred scope.
export function serverIngressFromEnvironment(values) {
  if (!INGRESS_PROFILE_KEYS.some((key) => values.has(key))) return null;
  const mode = values.get("DEPLOYMENT_MODE");
  const input = {
    format: 1,
    mode,
    publicOrigin: values.get("PUBLIC_ORIGIN"),
    accessScope: values.get("INGRESS_ACCESS_SCOPE"),
    tlsProvider: values.get("INGRESS_TLS_PROVIDER"),
    ...(values.has("INGRESS_LISTEN_ADDRESS")
      ? { listenAddress: values.get("INGRESS_LISTEN_ADDRESS") }
      : {}),
    ...(values.has("INGRESS_LAN_NETWORKS")
      ? { allowedNetworks: values.get("INGRESS_LAN_NETWORKS").split(",") }
      : {}),
  };
  const review = validateServerIngressReview(input);
  if (review.tlsProvider === "automatic")
    throw new Error(
      "Automatic HTTPS is not implemented; select custom TLS or existing Cloudflare ingress",
    );
  return review;
}

export function validateServerIngressReview(input) {
  const model = record(input, "ingress review", [
    "format",
    "mode",
    "publicOrigin",
    "accessScope",
    "tlsProvider",
    "listenAddress",
    "allowedNetworks",
  ]);
  if (model.format !== 1) throw new Error("Ingress review format must be 1");
  const mode = text(model, "mode", "ingress.mode");
  const scope = text(model, "accessScope", "ingress.accessScope");
  const provider = text(model, "tlsProvider", "ingress.tlsProvider");
  const rawOrigin = text(model, "publicOrigin", "ingress.publicOrigin");
  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error("Ingress requires an exact HTTPS origin");
  }
  if (
    /[\s\\]/u.test(rawOrigin) ||
    [...rawOrigin].some(
      (char) => char.charCodeAt(0) <= 0x1f || char.charCodeAt(0) === 0x7f,
    ) ||
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  )
    throw new Error("Ingress requires an exact HTTPS origin");
  if (!["local", "lan", "internet"].includes(scope))
    throw new Error("Ingress access scope must be local, lan or internet");
  if (mode === "cloudflare") {
    if (
      scope !== "internet" ||
      provider !== "cloudflare" ||
      Object.hasOwn(model, "listenAddress") ||
      Object.hasOwn(model, "allowedNetworks")
    )
      throw new Error(
        "Cloudflare ingress preserves its external configuration; do not add standalone listener settings",
      );
    return Object.freeze({
      format: 1,
      mode,
      publicOrigin: origin.origin,
      accessScope: scope,
      tlsProvider: provider,
    });
  }
  if (mode !== "standalone" || !["custom", "automatic"].includes(provider))
    throw new Error("Standalone ingress requires custom or automatic HTTPS");
  const hostname = origin.hostname.replace(/^\[|\]$/g, "");
  if (
    !isIP(hostname) &&
    (hostname.length > 253 ||
      !hostname
        .split(".")
        .every((label) =>
          /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label),
        ))
  )
    throw new Error(
      "Standalone ingress requires an IP or DNS labels without a trailing dot",
    );
  const address = text(model, "listenAddress", "ingress.listenAddress");
  const ip = addressValue(address);
  const loopback = inNetwork(ip, "127.0.0.0/8") || inNetwork(ip, "::1/128");
  const unspecified = ip.value === 0n;
  if (scope === "local" && !loopback)
    throw new Error("Local ingress must listen on loopback only");
  if (scope === "lan" && !privateAddress(ip))
    throw new Error(
      "LAN ingress must bind an explicit private interface address",
    );
  if (scope === "internet" && loopback)
    throw new Error(
      "Internet ingress requires an external or wildcard listen address",
    );
  if (
    !unspecified &&
    (inNetwork(ip, "0.0.0.0/8") ||
      inNetwork(ip, "169.254.0.0/16") ||
      inNetwork(ip, "fe80::/10") ||
      inNetwork(ip, "224.0.0.0/4") ||
      inNetwork(ip, "240.0.0.0/4") ||
      inNetwork(ip, "ff00::/8") ||
      inNetwork(ip, "::ffff:0:0/96"))
  )
    throw new Error("Ingress listener must be a unicast address");
  if (Number(origin.port || 443) >= 3100 && Number(origin.port || 443) <= 3199)
    throw new Error(
      "Ingress port overlaps reserved internal application ports",
    );
  let networks;
  if (scope === "lan") {
    const raw = model.allowedNetworks;
    if (
      !Array.isArray(raw) ||
      Object.getPrototypeOf(raw) !== Array.prototype ||
      raw.length < 1 ||
      raw.length > 32
    )
      throw new Error(
        "LAN ingress requires 1–32 explicit private client networks",
      );
    const descriptors = Object.getOwnPropertyDescriptors(raw);
    if (Reflect.ownKeys(raw).length !== raw.length + 1)
      throw new Error("LAN networks must be plain data entries");
    networks = [];
    const identities = new Set();
    for (let i = 0; i < raw.length; i++) {
      if (!descriptors[i] || !Object.hasOwn(descriptors[i], "value"))
        throw new Error("LAN networks must be plain data entries");
      const value = descriptors[i].value;
      const network = networkValue(value);
      // Routed private clients need not share the server subnet.
      if (!privateNetwork(network))
        throw new Error("LAN client networks must be private canonical CIDRs");
      const identity = `${network.family}/${network.value}/${network.prefix}`;
      if (identities.has(identity))
        throw new Error("LAN client networks must be unique");
      identities.add(identity);
      networks.push(value);
    }
    if (!networks.some((value) => inNetwork(ip, value)))
      throw new Error(
        "LAN client networks must include the selected interface subnet",
      );
  } else if (Object.hasOwn(model, "allowedNetworks"))
    throw new Error("Client networks are only supported for LAN ingress");
  return Object.freeze({
    format: 1,
    mode,
    publicOrigin: origin.origin,
    accessScope: scope,
    tlsProvider: provider,
    listenAddress: address,
    ...(networks ? { allowedNetworks: Object.freeze(networks) } : {}),
  });
}

export function serverIngressReviewEnvironment(input) {
  const review = validateServerIngressReview(input);
  return new Map([
    ["INGRESS_ACCESS_SCOPE", review.accessScope],
    ["INGRESS_TLS_PROVIDER", review.tlsProvider],
    ...(review.mode === "standalone"
      ? [["INGRESS_LISTEN_ADDRESS", review.listenAddress]]
      : []),
    ...(review.allowedNetworks
      ? [["INGRESS_LAN_NETWORKS", review.allowedNetworks.join(",")]]
      : []),
  ]);
}

export function serverIngressContainsAddress(network, address) {
  return networkContains(networkValue(network), addressValue(address));
}

function addressValue(address) {
  if (typeof address !== "string" || address.includes("%") || !isIP(address))
    throw new Error(
      "Ingress address must be a literal IPv4/IPv6 address without zone or port",
    );
  const family = isIP(address);
  if (family === 4)
    return {
      family,
      value: address
        .split(".")
        .reduce((n, octet) => (n << 8n) | BigInt(octet), 0n),
    };
  // URL canonicalization expands dotted IPv4 tails into hexadecimal groups.
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const parts = canonical.split("::");
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const groups =
    parts.length === 2
      ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right]
      : left;
  return {
    family,
    value: groups.reduce((n, word) => (n << 16n) | BigInt(`0x${word}`), 0n),
  };
}
function networkValue(value) {
  if (typeof value !== "string" || !/^[0-9a-fA-F:.]+\/[0-9]+$/.test(value))
    throw new Error("LAN networks must be literal canonical CIDRs");
  const [address, rawPrefix] = value.split("/");
  const ip = addressValue(address);
  const prefix = Number(rawPrefix),
    bits = ip.family === 4 ? 32 : 128;
  if (
    !Number.isInteger(prefix) ||
    prefix < 0 ||
    prefix > bits ||
    String(prefix) !== rawPrefix
  )
    throw new Error("LAN network prefix is invalid");
  const mask =
    ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
  if ((ip.value & mask) !== ip.value)
    throw new Error("LAN CIDR contains host bits");
  return { ...ip, prefix, mask };
}
function networkContains(network, ip) {
  return (
    network.family === ip.family && (ip.value & network.mask) === network.value
  );
}
function inNetwork(ip, value) {
  return networkContains(networkValue(value), ip);
}
const PRIVATE_NETWORKS = [
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "fc00::/7",
];
function privateAddress(ip) {
  return PRIVATE_NETWORKS.some((value) => inNetwork(ip, value));
}
function privateNetwork(network) {
  return PRIVATE_NETWORKS.some((value) => {
    const parent = networkValue(value);
    return network.prefix >= parent.prefix && networkContains(parent, network);
  });
}
