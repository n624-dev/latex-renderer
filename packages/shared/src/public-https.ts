import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import type { RequestOptions } from "node:https";
import { BlockList, isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

const specialUse = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  specialUse.addSubnet(network, prefix);

const globalUnicastV6 = new BlockList();
globalUnicastV6.addSubnet("2000::", 3, "ipv6");
specialUse.addSubnet("2001::", 23, "ipv6");
specialUse.addSubnet("2001:db8::", 32, "ipv6");
specialUse.addSubnet("2002::", 16, "ipv6");
specialUse.addSubnet("3fff::", 20, "ipv6");

type PinnedDestination = Pick<
  RequestOptions,
  | "hostname"
  | "family"
  | "port"
  | "servername"
  | "path"
  | "agent"
  | "checkServerIdentity"
  | "rejectUnauthorized"
>;

/** Check the trusted origin and resolve a public address for a single HTTPS hop. */
export async function pinPublicHttps(
  url: URL,
  trustedOrigin: string,
  signal: AbortSignal,
): Promise<PinnedDestination | null> {
  if (
    url.origin !== trustedOrigin ||
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    isIP(url.hostname.replace(/^\[|\]$/g, ""))
  )
    return null;

  const { hostname, port, pathname, search } = url;
  const addresses = await new Promise<LookupAddress[]>((resolve, reject) => {
    signal.throwIfAborted();
    const stop = () =>
      reject(new Error("HTTPS DNS lookup aborted", { cause: signal.reason }));
    signal.addEventListener("abort", stop, { once: true });
    void lookup(hostname, { all: true })
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", stop));
  });
  signal.throwIfAborted();
  const address = addresses.find(
    ({ address, family }) =>
      isIP(address) === family &&
      (family === 4
        ? !specialUse.check(address)
        : family === 6 &&
          globalUnicastV6.check(address, "ipv6") &&
          !specialUse.check(address, "ipv6")),
  );
  if (!address) return null;

  // Connect to the selected address. SNI and certificate checks still use the
  // original DNS name, and a subsequent request must resolve its own address.
  return {
    hostname: address.address,
    family: address.family,
    port: port || 443,
    servername: hostname,
    path: pathname + search,
    agent: false,
    rejectUnauthorized: true,
    checkServerIdentity: (_name, certificate) =>
      checkServerIdentity(hostname, certificate),
  };
}
