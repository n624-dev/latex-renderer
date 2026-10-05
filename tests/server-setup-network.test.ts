import { describe, expect, it } from "vitest";
import { assertServerSetupSockets } from "../deploy/scripts/server-setup-network.mjs";
import { validateServerIngressReview } from "../packages/server-setup-core/src/index.mjs";
const ingress = validateServerIngressReview({
  format: 1,
  mode: "standalone",
  publicOrigin: "https://localhost",
  accessScope: "local",
  listenAddress: "127.0.0.1",
  tlsProvider: "custom",
});
const row = (address: string, port: number) =>
  `LISTEN 0 512 ${address}:${port} 0.0.0.0:*`;
describe("read-only prepared-host network boundary", () => {
  it("accepts empty fresh ports and ignores unrelated co-hosted listeners", () => {
    expect(() =>
      assertServerSetupSockets(row("127.0.0.1", 19999), ingress, {
        fresh: true,
        checkIngressPort: true,
      }),
    ).not.toThrow();
  });
  it.each(["0.0.0.0", "[::]", "*", "192.168.1.10"])(
    "rejects an exposed backend on %s",
    (address) => {
      expect(() =>
        assertServerSetupSockets(row(address, 3102), ingress),
      ).toThrow("publicly exposed");
    },
  );
  it("refuses occupied internal or HTTPS ports before initial mutation", () => {
    expect(() =>
      assertServerSetupSockets(row("127.0.0.1", 3102), ingress, {
        fresh: true,
      }),
    ).toThrow("occupied");
    for (const address of ["0.0.0.0", "[::]", "127.0.0.1"])
      expect(() =>
        assertServerSetupSockets(row(address, 443), ingress, {
          checkIngressPort: true,
        }),
      ).toThrow("HTTPS");
    expect(() =>
      assertServerSetupSockets(row("192.168.1.10", 443), ingress, {
        checkIngressPort: true,
      }),
    ).not.toThrow();
  });
  it("requires all selected private backends before declaring setup healthy", () => {
    const ports = [3100, 3101, 3102, 3103, 3104, 3105, 3110];
    const sockets = ports.map((port) => row("127.0.0.1", port)).join("\n");
    expect(() =>
      assertServerSetupSockets(sockets, ingress, { requireInternal: true }),
    ).not.toThrow();
    expect(() =>
      assertServerSetupSockets(
        sockets.replace(row("127.0.0.1", 3103), ""),
        ingress,
        { requireInternal: true },
      ),
    ).toThrow("unavailable");
  });
  it.each([
    ["malformed", "not ss output"],
    ["invalid port", "LISTEN 0 512 127.0.0.1:99999 *:*"],
    ["oversized", "x".repeat(256 * 1024 + 1)],
  ])("fails closed on %s inventories", (_label, output) => {
    expect(() => assertServerSetupSockets(output, ingress)).toThrow(
      "Cannot verify",
    );
  });
});
