import { describe, expect, it, vi } from "vitest";
import {
  validateServerIngressReview as validate,
  serverIngressFromEnvironment,
  serverIngressReviewEnvironment,
  serverIngressContainsAddress,
  parseEnvironmentFile,
  validateProfileValues,
  productionAuthenticationPlan,
  importServerSetupProfile,
  importServerSetupAuthenticationReview,
  importServerSetupDeploymentReview,
  validateServerSetupDeploymentReview,
  serverSetupDeploymentReviewEnvironment,
  renderServerIngressNginx,
} from "../packages/server-setup-core/src/index.mjs";
import {
  verifyIngressInterface,
  verifyProductionIngressTls,
} from "../deploy/scripts/server-ingress.mjs";
import { authenticationChangeReview } from "../deploy/scripts/authentication-change.mjs";

const local = {
  format: 1,
  mode: "standalone",
  publicOrigin: "https://localhost:8443",
  accessScope: "local",
  tlsProvider: "custom",
  listenAddress: "127.0.0.1",
};
const lan = {
  ...local,
  publicOrigin: "https://renderer.example.test",
  accessScope: "lan",
  listenAddress: "192.168.1.2",
  allowedNetworks: ["192.168.1.0/24"],
};
const legacy =
  "DEPLOYMENT_MODE=standalone\nAUTH_MODE=password\nPUBLIC_ORIGIN=https://localhost:8443\nRENDERER_PUBLIC_URL=https://localhost:8443";
const ingress =
  "\nINGRESS_ACCESS_SCOPE=local\nINGRESS_TLS_PROVIDER=custom\nINGRESS_LISTEN_ADDRESS=127.0.0.1";
const serialize = (values: ReadonlyMap<string, string>) =>
  [...values].map(([k, v]) => `${k}=${v}`).join("\n");

describe("explicit server ingress and complete deployment review", () => {
  it.each([
    local,
    lan,
    { ...local, accessScope: "internet", listenAddress: "0.0.0.0" },
    { ...local, listenAddress: "::1" },
    { ...lan, listenAddress: "fd12::2", allowedNetworks: ["fd12::/64"] },
    {
      format: 1,
      mode: "cloudflare",
      publicOrigin: local.publicOrigin,
      accessScope: "internet",
      tlsProvider: "cloudflare",
    },
  ])("validates an explicit scope without host/provider I/O: %j", (input) => {
    const checked = validate(input);
    expect(Object.isFrozen(checked)).toBe(true);
    expect(validate(structuredClone(checked))).toEqual(checked);
    const values = new Map([
      ["DEPLOYMENT_MODE", checked.mode],
      ["PUBLIC_ORIGIN", checked.publicOrigin],
      ...serverIngressReviewEnvironment(checked),
    ]);
    expect(serverIngressFromEnvironment(values)).toEqual(checked);
  });
  it("does not infer legacy exposure, read certificates or lose new settings in old imports", () => {
    expect(
      serverIngressFromEnvironment(parseEnvironmentFile(legacy)),
    ).toBeNull();
    expect(importServerSetupDeploymentReview(legacy).ingress).toBeNull();
    expect(verifyProductionIngressTls(null, 99999)).toBeNull();
    expect(() => importServerSetupProfile(legacy + ingress)).toThrow(
      /cannot preserve ingress/,
    );
    expect(() =>
      importServerSetupAuthenticationReview(legacy + ingress),
    ).toThrow(/cannot preserve ingress/);
    expect(() =>
      productionAuthenticationPlan(parseEnvironmentFile(legacy + ingress)),
    ).not.toThrow();
  });
  it("round-trips authentication plus ingress together, excluding secret/unrelated keys", () => {
    const review = importServerSetupDeploymentReview(
      legacy +
        ingress +
        "\nOIDC_CLIENT_SECRET_FILE=/private/excluded\nSTORAGE_DIR=/unrelated",
    );
    expect(review.ingress).toEqual(local);
    expect(Object.isFrozen(review)).toBe(true);
    const values = serverSetupDeploymentReviewEnvironment(review);
    expect(importServerSetupDeploymentReview(serialize(values))).toEqual(
      review,
    );
    expect(serialize(values)).not.toMatch(/excluded|unrelated|SECRET/);
    expect(() =>
      validateServerSetupDeploymentReview({
        ...review,
        ingress: { ...local, publicOrigin: "https://other.test" },
      }),
    ).toThrow(/must match/);
    expect(() =>
      validateServerSetupDeploymentReview({ ...review, ingress: undefined }),
    ).toThrow();
  });
  it("preserves every ingress/secret-reference line during an authentication-only cutover", () => {
    const contents =
      legacy + ingress + "\nINTERNAL_TOKEN_FILE=/fixture/private/token\n";
    const review = importServerSetupDeploymentReview(contents);
    const changed = authenticationChangeReview(contents, review.authentication);
    for (const line of ingress.trim().split("\n"))
      expect(changed.after).toContain(line);
    expect(changed.after).toContain(
      "INTERNAL_TOKEN_FILE=/fixture/private/token",
    );
    expect(
      productionAuthenticationPlan(parseEnvironmentFile(changed.after))
        .authMode,
    ).toBe("password");
    expect(importServerSetupDeploymentReview(changed.after).ingress).toEqual(
      review.ingress,
    );
    expect(JSON.stringify(changed.envelope)).not.toMatch(/private\/token/);
  });
  it.each([
    { listenAddress: "0.0.0.0" },
    { listenAddress: "192.168.1.2" },
    { listenAddress: "::ffff:127.0.0.1" },
    { listenAddress: "127.0.0.1; include /private" },
    { listenAddress: "localhost" },
    { listenAddress: "::1%lo" },
    { publicOrigin: "https://local\nhost" },
    { publicOrigin: "https://localhost\\evil" },
    { publicOrigin: "http://localhost" },
    { publicOrigin: "https://localhost/path" },
    { publicOrigin: "https://localhost." },
    { publicOrigin: "https://.localhost" },
    { publicOrigin: "https://unsafe;host.test" },
    { publicOrigin: "https://localhost:3105" },
    { allowedNetworks: [] },
    { tlsProvider: "cloudflare" },
    { accessScope: "auto" },
    { format: 2 },
    { secret: "not-allowed" },
  ])("rejects unsafe local review %j", (change) =>
    expect(() => validate({ ...local, ...change })).toThrow(),
  );
  it.each([
    { listenAddress: "0.0.0.0" },
    { listenAddress: "8.8.8.8" },
    { allowedNetworks: [] },
    { allowedNetworks: ["0.0.0.0/0"] },
    { allowedNetworks: ["192.168.1.2/24"] },
    { allowedNetworks: ["10.0.0.0/8"] },
    { allowedNetworks: ["192.168.1.0/24", "192.168.1.0/24"] },
    { allowedNetworks: ["192.168.1.0/24; return 200"] },
    { allowedNetworks: ["192.168.1.0/024"] },
    { allowedNetworks: ["192.168.1.0/33"] },
    { allowedNetworks: Array(33).fill("192.168.1.0/24") },
  ])("rejects unsafe LAN review %j", (change) =>
    expect(() => validate({ ...lan, ...change })).toThrow(),
  );
  it("rejects IPv6 equivalent duplicate CIDRs and host bits", () => {
    expect(() =>
      validate({
        ...lan,
        listenAddress: "fd12::1",
        allowedNetworks: ["fd12::/64", "fd12:0:0:0::/64"],
      }),
    ).toThrow(/unique/);
    expect(() =>
      validate({
        ...lan,
        listenAddress: "fd12::1",
        allowedNetworks: ["fd12::1/64"],
      }),
    ).toThrow(/host bits/);
    expect(serverIngressContainsAddress("fd12::/64", "fd12::4")).toBe(true);
    expect(serverIngressContainsAddress("fd12::/64", "fd13::4")).toBe(false);
    expect(
      serverIngressContainsAddress("192.168.1.0/24", "::ffff:192.168.1.2"),
    ).toBe(false);
  });
  it("rejects sparse/accessor/prototype/symbol inputs without invoking getters", () => {
    const getter = vi.fn(() => "192.168.1.0/24");
    const networks = [] as string[];
    Object.defineProperty(networks, 0, { get: getter });
    expect(() => validate({ ...lan, allowedNetworks: networks })).toThrow(
      /plain data/,
    );
    expect(getter).not.toHaveBeenCalled();
    expect(() => validate({ ...lan, allowedNetworks: Array(1) })).toThrow();
    const object = { ...local };
    Object.defineProperty(object, "listenAddress", { get: getter });
    expect(() => validate(object)).toThrow(/accessors/);
    expect(getter).not.toHaveBeenCalled();
    expect(() => validate(Object.create(local))).toThrow(/plain object/);
    expect(() => validate({ ...local, [Symbol()]: 1 })).toThrow();
  });
  it.each([
    "INGRESS_ACCESS_SCOPE=local",
    "INGRESS_TLS_PROVIDER=custom",
    "INGRESS_LISTEN_ADDRESS=127.0.0.1",
    "INGRESS_LAN_NETWORKS=192.168.0.0/16",
  ])(
    "fails partial ENV before production authentication/secret steps: %s",
    (entry) => {
      const values = parseEnvironmentFile(`${legacy}\n${entry}`);
      expect(() => validateProfileValues(values)).toThrow();
      expect(() => productionAuthenticationPlan(values)).toThrow();
    },
  );
  it("keeps automatic HTTPS reviewable but not activatable until implemented", () => {
    expect(validate({ ...local, tlsProvider: "automatic" }).tlsProvider).toBe(
      "automatic",
    );
    expect(() =>
      serverIngressFromEnvironment(
        parseEnvironmentFile(
          (legacy + ingress).replace(
            "TLS_PROVIDER=custom",
            "TLS_PROVIDER=automatic",
          ),
        ),
      ),
    ).toThrow(/not implemented/);
    expect(() =>
      renderServerIngressNginx({ ...local, tlsProvider: "automatic" }),
    ).toThrow();
  });
  it("keeps Cloudflare external settings unchanged and never reads custom TLS", () => {
    const checked = validate({
      format: 1,
      mode: "cloudflare",
      publicOrigin: "https://renderer.example.test",
      accessScope: "internet",
      tlsProvider: "cloudflare",
    });
    expect(verifyProductionIngressTls(checked, 99999)).toBeNull();
    expect(() => renderServerIngressNginx(checked)).toThrow();
    expect(() => validate({ ...checked, listenAddress: "0.0.0.0" })).toThrow();
    expect(() => validate({ ...checked, accessScope: "local" })).toThrow();
  });
  it("requires the selected address to remain assigned, without guessing another interface", () => {
    expect(() => verifyIngressInterface(validate(lan), {})).toThrow(
      /not assigned/,
    );
    const interfaces = {
      eth0: [
        {
          address: "192.168.1.2",
          family: "IPv4" as const,
          netmask: "255.255.255.0",
          mac: "00:00:00:00:00:00",
          internal: false,
          cidr: "192.168.1.2/24",
        },
      ],
    };
    expect(() =>
      verifyIngressInterface(validate(lan), interfaces),
    ).not.toThrow();
    expect(() =>
      verifyIngressInterface(
        validate({
          ...local,
          accessScope: "internet",
          listenAddress: "0.0.0.0",
        }),
        {},
      ),
    ).not.toThrow();
  });
});
