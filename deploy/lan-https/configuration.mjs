import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readSync,
  lstatSync,
  realpathSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { isIP } from "node:net";
import { URL } from "node:url";
import { validateServerIngressReview } from "../../packages/server-setup-core/src/ingress-review.mjs";
import { profileRecord } from "../../packages/server-setup-core/src/profile-shape.mjs";
import {
  validateLanHttpsAuthorityPolicy,
  validateLanHttpsProvider,
  normalizeLanHttpsDomain,
} from "../../packages/server-setup-core/src/lan-https.mjs";

export function readLanHttpsBytes(
  path,
  { secret = false, maximumBytes = 65536 } = {},
) {
  if (
    typeof path !== "string" ||
    path !== resolve(path) ||
    realpathSync(path) !== path
  )
    throw new Error(
      "LAN HTTPS configuration requires a canonical absolute regular file",
    );
  const parent = lstatSync(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.mode & 0o022 ||
    ![0, process.geteuid()].includes(parent.uid)
  )
    throw new Error("Unsafe LAN HTTPS configuration directory");
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = fstatSync(fd);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      ![0, process.geteuid()].includes(before.uid) ||
      before.mode & 0o022 ||
      (secret &&
        (before.mode & 0o7777) !== 0o600 &&
        (before.mode & 0o7777) !== 0o400) ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > 528 * 1024 ||
      before.size < 1 ||
      before.size > maximumBytes
    )
      throw new Error("Unsafe LAN HTTPS configuration file");
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fstatSync(fd);
    if (
      size !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error("LAN HTTPS configuration changed during read");
    return bytes.subarray(0, size);
  } finally {
    closeSync(fd);
  }
}
export function readLanHttpsConfiguration(path, options = {}) {
  return JSON.parse(readLanHttpsBytes(path, options).toString("utf8"));
}
function absolute(value) {
  if (
    typeof value !== "string" ||
    value !== resolve(value) ||
    value === "/" ||
    value.length > 4096
  )
    throw new Error(
      "LAN HTTPS requires an absolute bounded state or credential path",
    );
  return value;
}
function port(value, allowEphemeral) {
  if (
    !Number.isSafeInteger(value) ||
    value < (allowEphemeral ? 0 : 1) ||
    value > 65535
  )
    throw new Error("Invalid LAN HTTPS port");
  return value;
}
function endpoint(value) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.href !== value
  )
    throw new Error("An exact HTTPS ACME endpoint is required");
  return value;
}
export function validateLanHttpsAuthorityConfiguration(
  input,
  { allowEphemeral = false } = {},
) {
  const value = profileRecord(input, "LAN HTTPS authority configuration", [
    "format",
    "role",
    "policy",
    "stateDirectory",
    "http",
    "dns",
    "issuers",
    "keyless",
  ]);
  if (value.format !== 1 || value.role !== "authority")
    throw new Error("Invalid LAN HTTPS authority role");
  const policy = validateLanHttpsAuthorityPolicy(value.policy);
  // The shared Keyless wildcard must never authenticate the control API.
  const apiHostname = new URL(policy.serverOrigin).hostname;
  if (
    apiHostname === policy.lanDomain ||
    apiHostname.endsWith("." + policy.lanDomain)
  )
    throw new Error(
      "Authority API must be outside the shared LAN certificate namespace",
    );
  const http = profileRecord(value.http, "authority HTTP", [
    "address",
    "port",
    "trustLoopbackProxy",
  ]);
  if (
    !["127.0.0.1", "::1"].includes(http.address) ||
    typeof http.trustLoopbackProxy !== "boolean"
  )
    throw new Error("Authority HTTP must use an explicit loopback TLS proxy");
  const dns = profileRecord(value.dns, "authority DNS", [
    "listeners",
    "nameserver",
    "caaIssuers",
  ]);
  if (
    !Array.isArray(dns.listeners) ||
    !dns.listeners.length ||
    dns.listeners.length > 4
  )
    throw new Error("Bounded DNS listeners required");
  const listeners = dns.listeners.map((entry) => {
    profileRecord(entry, "DNS listener", ["address", "port"]);
    if (!isIP(entry.address))
      throw new Error("DNS requires a numeric bind address");
    return Object.freeze({
      address: entry.address,
      port: port(entry.port, allowEphemeral),
    });
  });
  if (
    new Set(listeners.map((v) => `${v.address}/${v.port}`)).size !==
    listeners.length
  )
    throw new Error("Duplicated DNS listener");
  if (
    !Array.isArray(dns.caaIssuers) ||
    dns.caaIssuers.length < 1 ||
    dns.caaIssuers.length > 8
  )
    throw new Error("Explicit bounded CAA policy required");
  const issuers = value.issuers;
  if (!Array.isArray(issuers) || issuers.length < 1 || issuers.length > 4)
    throw new Error("One to four ACME issuers required");
  const checkedIssuers = issuers.map((entry) => {
    profileRecord(entry, "authority issuer", [
      "id",
      "directoryUrl",
      "newAccountUrl",
      "eabFile",
    ]);
    if (
      typeof entry.id !== "string" ||
      !/^[a-z][a-z0-9-]{0,31}$/.test(entry.id)
    )
      throw new Error("Invalid issuer ID");
    const directoryUrl = endpoint(entry.directoryUrl),
      newAccountUrl = endpoint(entry.newAccountUrl);
    if (new URL(directoryUrl).origin !== new URL(newAccountUrl).origin)
      throw new Error("Mismatched issuer endpoints");
    return Object.freeze({
      id: entry.id,
      directoryUrl,
      newAccountUrl,
      ...(entry.eabFile === undefined
        ? {}
        : { eabFile: absolute(entry.eabFile) }),
    });
  });
  if (new Set(checkedIssuers.map((v) => v.id)).size !== checkedIssuers.length)
    throw new Error("Duplicated ACME issuer");
  let keyless = null;
  if (value.keyless !== undefined && value.keyless !== null) {
    profileRecord(value.keyless, "authority Keyless", ["binary", "bundleFile"]);
    keyless = Object.freeze({
      ...(value.keyless.binary === undefined
        ? {}
        : { binary: absolute(value.keyless.binary) }),
      bundleFile: absolute(value.keyless.bundleFile),
    });
  }
  return Object.freeze({
    format: 1,
    role: "authority",
    policy,
    stateDirectory: absolute(value.stateDirectory),
    http: Object.freeze({
      address: http.address,
      port: port(http.port, allowEphemeral),
      trustLoopbackProxy: http.trustLoopbackProxy,
    }),
    dns: Object.freeze({
      listeners: Object.freeze(listeners),
      nameserver: normalizeLanHttpsDomain(dns.nameserver),
      caaIssuers: Object.freeze(dns.caaIssuers.map(normalizeLanHttpsDomain)),
    }),
    issuers: Object.freeze(checkedIssuers),
    keyless,
  });
}
export function validateLanHttpsClientConfiguration(input) {
  const value = profileRecord(input, "LAN HTTPS client configuration", [
    "format",
    "role",
    "provider",
    "stateDirectory",
    "issuerId",
    "termsAccepted",
    "invitationFile",
    "allowedNetworks",
  ]);
  if (
    value.format !== 1 ||
    value.role !== "client" ||
    typeof value.termsAccepted !== "boolean" ||
    typeof value.issuerId !== "string" ||
    !/^[a-z][a-z0-9-]{0,31}$/.test(value.issuerId) ||
    !Array.isArray(value.allowedNetworks) ||
    !value.allowedNetworks.length ||
    value.allowedNetworks.length > 32 ||
    value.allowedNetworks.some((v) => typeof v !== "string" || v.length > 64)
  )
    throw new Error("Invalid LAN HTTPS client settings");
  const provider = validateLanHttpsProvider(value.provider);
  validateServerIngressReview({
    format: 1,
    mode: "standalone",
    accessScope: "lan",
    tlsProvider: "automatic",
    publicOrigin: provider.publicOrigin,
    listenAddress: provider.address,
    allowedNetworks: value.allowedNetworks,
    lanHttps: {
      format: 1,
      provider,
      issuerId: value.issuerId,
      termsAccepted: value.termsAccepted,
    },
  });
  return Object.freeze({
    format: 1,
    role: "client",
    provider,
    stateDirectory: absolute(value.stateDirectory),
    issuerId: value.issuerId,
    termsAccepted: value.termsAccepted,
    allowedNetworks: Object.freeze([...value.allowedNetworks]),
    ...(value.invitationFile === undefined
      ? {}
      : { invitationFile: absolute(value.invitationFile) }),
  });
}

export function readLanHttpsInvitation(config) {
  if (!config.invitationFile) return undefined;
  const value = readLanHttpsConfiguration(config.invitationFile, {
    secret: true,
    maximumBytes: 4096,
  });
  if (
    !value ||
    Object.keys(value).sort().join(",") !==
      "format,invitationCode,serverOrigin" ||
    value.format !== 1 ||
    typeof value.serverOrigin !== "string" ||
    (value.invitationCode !== "" &&
      value.serverOrigin !== config.provider.serverOrigin) ||
    typeof value.invitationCode !== "string" ||
    (value.invitationCode !== "" &&
      !/^[A-Za-z0-9_-]{43}$/.test(value.invitationCode))
  )
    throw new Error(
      "Saved invitation does not match this authority; enter its code again",
    );
  return value.invitationCode || undefined;
}
