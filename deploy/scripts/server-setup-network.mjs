import { URL } from "node:url";
const internalPorts = [3100, 3101, 3102, 3103, 3104, 3105, 3110];
/** Parse only numeric `ss -H -ltn` output; never trust forwarding headers,
 * process names or browser-supplied socket inventories. No state changes.
 */
export function assertServerSetupSockets(output, ingress, options = {}) {
  if (typeof output !== "string" || Buffer.byteLength(output) > 256 * 1024)
    throw new Error("Cannot verify application socket exposure");
  const listeners = output.trim()
    ? output
        .trim()
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const fields = line.trim().split(/\s+/);
          const endpoint = /^(.*):([0-9]{1,5})$/.exec(fields[3] ?? "");
          if (
            fields.length < 5 ||
            fields[0] !== "LISTEN" ||
            !endpoint ||
            Number(endpoint[2]) > 65535
          )
            throw new Error("Cannot verify application socket exposure");
          return {
            address: endpoint[1].replace(/^\[|\]$/g, ""),
            port: Number(endpoint[2]),
          };
        })
    : [];
  const ports =
    ingress.tlsProvider === "automatic"
      ? [...internalPorts, 3180]
      : internalPorts;
  for (const listener of listeners.filter((entry) =>
    ports.includes(entry.port),
  )) {
    if (
      options.fresh ||
      !(listener.address === "127.0.0.1" || listener.address === "::1")
    )
      throw new Error(
        "Internal application port is occupied or publicly exposed",
      );
  }
  if (options.requireInternal) {
    const required = ports.filter(
      (port) => port !== 3105 || ingress.mode === "standalone",
    );
    if (
      required.some((port) => !listeners.some((entry) => entry.port === port))
    )
      throw new Error("Internal application listener is unavailable");
  }
  if (
    options.checkLanBackendPort &&
    ingress.tlsProvider === "automatic" &&
    listeners.some((entry) => entry.port === 3180)
  )
    throw new Error("LAN HTTPS loopback backend port 3180 is occupied");
  if (options.checkIngressPort && ingress.mode === "standalone") {
    const port = Number(new URL(ingress.publicOrigin).port || 443);
    const wild = (address) => ["*", "0.0.0.0", "::"].includes(address);
    if (
      listeners.some(
        (entry) =>
          entry.port === port &&
          (wild(entry.address) ||
            wild(ingress.listenAddress) ||
            entry.address === ingress.listenAddress),
      )
    )
      throw new Error("Requested HTTPS listener is already occupied");
  }
}
