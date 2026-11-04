import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { ingressTlsFixture } from "./server-ingress.js";
import type { LanHttpsAcmeDriver } from "../../deploy/lan-https/acme.mjs";
import type { LanHttpsAuthorityClient } from "../../deploy/lan-https/authority-client.mjs";
import type { Authorization, Order } from "acme-client";
import { createLanHttpsCertificateRequest } from "../../deploy/lan-https/acme.mjs";

export async function lanCertificateFixture(
  options: { installationId?: string; tlsKey?: string; address?: string } = {},
) {
  const root = ingressTlsFixture({ ca: true });
  try {
    const provider = {
      format: 1,
      provider: "akebi-local-acme",
      serverOrigin: "https://akebi.example.test",
      lanDomain: "lan.example.test",
      address: options.address ?? "192.168.1.50",
      keylessFallback: true,
    };
    const id = options.installationId ?? "a".repeat(64);
    const accountKey = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    }).privateKey;
    const tlsKey =
      options.tlsKey ??
      generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
        privateKeyEncoding: { format: "pem", type: "pkcs8" },
        publicKeyEncoding: { format: "pem", type: "spki" },
      }).privateKey;
    const request = await createLanHttpsCertificateRequest({
      provider,
      installationId: id,
      privateKey: tlsKey,
    });
    const output = join(root.root, "issued.pem");
    execFileSync(
      "openssl",
      [
        "x509",
        "-req",
        "-CA",
        root.certificatePath,
        "-CAkey",
        root.keyPath,
        "-set_serial",
        "12345",
        "-days",
        "1",
        "-copy_extensions",
        "copy",
        "-out",
        output,
      ],
      {
        input: request.csr,
        stdio: ["pipe", "ignore", "ignore"],
        timeout: 10000,
      },
    );
    const certificate =
      readFileSync(output, "utf8") + root.certificate.toString();
    const events: string[] = [];
    let registered = false;
    const order: Order = {
      status: "pending",
      identifiers: request.hostnames.map((value) => ({ type: "dns", value })),
      authorizations: [],
      finalize: "https://acme.example.test/finalize",
      url: "https://acme.example.test/order",
    };
    const authorizations: Authorization[] = request.hostnames.map((value) => ({
      url: "https://acme.example.test/authorization",
      identifier: { type: "dns", value },
      status: "pending",
      challenges: [
        {
          type: "dns-01",
          status: "pending",
          token: "fixture",
          url: "https://acme.example.test/challenge",
        },
      ],
    }));
    const authority: Pick<
      LanHttpsAuthorityClient,
      | "installationId"
      | "bindAcmeAccount"
      | "presentChallenge"
      | "removeChallenge"
    > = {
      installationId: id,
      bindAcmeAccount: () => {
        events.push("bind");
        return Promise.resolve({
          protected: "fixture",
          payload: "fixture",
          signature: "fixture",
        });
      },
      presentChallenge: (name) => {
        events.push(`present:${name}`);
        return Promise.resolve({ id: name, expiresAt: Date.now() + 600000 });
      },
      removeChallenge: (name) => {
        events.push(`remove:${name}`);
        return Promise.resolve({ removed: true });
      },
    };
    const client: LanHttpsAcmeDriver = {
      getAccountUrl: () => {
        if (!registered) throw new Error("Unregistered fixture account");
        return "https://acme.example.test/account";
      },
      createAccount: () => {
        registered = true;
        events.push("account");
        return Promise.resolve();
      },
      createOrder: () => {
        events.push("order");
        return Promise.resolve(order);
      },
      getOrder: () => Promise.resolve({ ...order, status: "ready" }),
      getAuthorizations: () => Promise.resolve(authorizations),
      getChallengeKeyAuthorization: () => Promise.resolve("a".repeat(43)),
      verifyChallenge: () => {
        events.push("verify");
        return Promise.resolve(true);
      },
      completeChallenge: () => {
        events.push("complete");
        return Promise.resolve();
      },
      waitForValidStatus: <T>(value: T) => Promise.resolve(value),
      finalizeOrder: () => {
        events.push("finalize");
        return Promise.resolve({ ...order, status: "processing" });
      },
      getCertificate: () => Promise.resolve(certificate),
    };
    return {
      root,
      provider,
      id,
      request,
      certificate,
      accountKey,
      tlsKey,
      authority,
      client,
      events,
      authorizations,
      cleanup: root.cleanup,
    };
  } catch (error) {
    root.cleanup();
    throw error;
  }
}
