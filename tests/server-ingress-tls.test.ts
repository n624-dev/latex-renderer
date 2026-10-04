import {
  chmodSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { createPrivateKey } from "node:crypto";
import { createServer, request } from "node:https";
import { spawnSync, execFileSync } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  validateServerIngressTls,
  validateServerIngressReview,
} from "../packages/server-setup-core/src/index.mjs";
import { readSecureIngressFile } from "../deploy/scripts/server-ingress.mjs";
import { ingressTlsFixture } from "./fixtures/server-ingress.js";

const review = validateServerIngressReview({
  format: 1,
  mode: "standalone",
  publicOrigin: "https://localhost",
  accessScope: "local",
  tlsProvider: "custom",
  listenAddress: "127.0.0.1",
});
let fixture: ReturnType<typeof ingressTlsFixture>;
let other: ReturnType<typeof ingressTlsFixture>;
const created: ReturnType<typeof ingressTlsFixture>[] = [];
beforeAll(() => {
  fixture = ingressTlsFixture();
  created.push(fixture);
  other = ingressTlsFixture();
  created.push(other);
});
afterAll(() => {
  for (const value of created) value.cleanup();
});

describe("custom ingress TLS preflight and actual trusted TLS", () => {
  it("rejects CA leaves, CN-only certificates and client-only EKU", () => {
    for (const options of [
      { ca: true },
      { subjectAltName: null },
      { extendedKeyUsage: "clientAuth" },
    ]) {
      const value = ingressTlsFixture(options);
      created.push(value);
      expect(() =>
        validateServerIngressTls(review, value.certificate, value.key),
      ).toThrow(/failed parsing/);
    }
  });
  it("validates a correctly ordered signed PEM chain and rejects reversed order", () => {
    const ca = ingressTlsFixture({ ca: true });
    created.push(ca);
    const csr = join(fixture.root, "leaf.csr"),
      signed = join(fixture.root, "signed.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-key",
        fixture.keyPath,
        "-subj",
        "/CN=localhost",
        "-addext",
        "basicConstraints=critical,CA:FALSE",
        "-addext",
        "subjectAltName=DNS:localhost",
        "-out",
        csr,
      ],
      { stdio: "ignore", timeout: 10000 },
    );
    execFileSync(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        csr,
        "-CA",
        ca.certificatePath,
        "-CAkey",
        ca.keyPath,
        "-set_serial",
        "2",
        "-days",
        "1",
        "-copy_extensions",
        "copy",
        "-out",
        signed,
      ],
      { stdio: "ignore", timeout: 10000 },
    );
    const leaf = readFileSync(signed);
    expect(() =>
      validateServerIngressTls(
        review,
        Buffer.concat([leaf, ca.certificate]),
        fixture.key,
      ),
    ).not.toThrow();
    expect(() =>
      validateServerIngressTls(
        review,
        Buffer.concat([ca.certificate, leaf]),
        fixture.key,
      ),
    ).toThrow(/chain/);
  });
  it("loads a matching SAN/key pair and emits only bounded non-secret identity", () => {
    const result = validateServerIngressTls(
      review,
      fixture.certificate,
      fixture.key,
    );
    expect(result.publicOrigin).toBe(review.publicOrigin);
    expect(result.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/BEGIN|PRIVATE|localhost.*key/);
    for (const host of ["127.0.0.1", "[::1]"])
      expect(() =>
        validateServerIngressTls(
          { ...review, publicOrigin: `https://${host}` },
          fixture.certificate,
          fixture.key,
        ),
      ).not.toThrow();
  });
  it("rejects mismatches, malformed/encrypted keys, SAN mismatch, expired/not-yet-valid certs and invalid chains", () => {
    const encrypted = createPrivateKey(fixture.key).export({
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase: "fixture-only",
    });
    const invalid = [
      other.key,
      Buffer.from("synthetic-private-do-not-echo"),
      Buffer.from(encrypted),
    ];
    for (const key of invalid)
      expect(() =>
        validateServerIngressTls(review, fixture.certificate, key),
      ).toThrow(/failed parsing/);
    expect(() =>
      validateServerIngressTls(
        { ...review, publicOrigin: "https://wrong.test" },
        fixture.certificate,
        fixture.key,
      ),
    ).toThrow(/SAN/);
    expect(() =>
      validateServerIngressTls(review, fixture.certificate, fixture.key, 0),
    ).toThrow(/validity/);
    expect(() =>
      validateServerIngressTls(
        review,
        fixture.certificate,
        fixture.key,
        Date.now() + 2 * 86400000,
      ),
    ).toThrow(/validity/);
    expect(() =>
      validateServerIngressTls(
        review,
        Buffer.concat([fixture.certificate, other.certificate]),
        fixture.key,
      ),
    ).toThrow(/chain/);
    expect(() =>
      validateServerIngressTls(review, Buffer.from("malformed"), fixture.key),
    ).toThrow(/parsing/);
    expect(() =>
      validateServerIngressTls(
        review,
        fixture.certificate,
        Buffer.alloc(16385),
      ),
    ).toThrow(/size/);
  });
  it("secure file reads enforce real descriptor metadata and reject symlink/hardlink/oversize/FIFO", () => {
    const uid = process.getuid?.(),
      gid = process.getgid?.();
    if (uid === undefined || gid === undefined)
      throw new Error("POSIX TLS file test requires uid/gid");
    const options = {
      uid,
      gid,
      mode: 0o440,
      maximumBytes: 2048,
    };
    const path = join(fixture.root, "bounded-secret");
    writeFileSync(path, "fixture secret", { mode: 0o440 });
    expect(readSecureIngressFile(path, options).toString()).toBe(
      "fixture secret",
    );
    chmodSync(path, 0o444);
    expect(() => readSecureIngressFile(path, options)).toThrow(/unsafe/);
    chmodSync(path, 0o440);
    expect(() =>
      readSecureIngressFile(path, { ...options, uid: options.uid + 1 }),
    ).toThrow(/unsafe/);
    expect(() =>
      readSecureIngressFile(path, { ...options, maximumBytes: 1 }),
    ).toThrow(/unsafe/);
    const alias = join(fixture.root, "symlink");
    symlinkSync(path, alias);
    expect(() => readSecureIngressFile(alias, options)).toThrow();
    const hardlink = join(fixture.root, "hardlink");
    linkSync(path, hardlink);
    expect(() => readSecureIngressFile(hardlink, options)).toThrow(/unsafe/);
    const fifo = join(fixture.root, "fifo");
    expect(spawnSync("mkfifo", [fifo], { timeout: 3000 }).status).toBe(0);
    expect(() => readSecureIngressFile(fifo, options)).toThrow(/unsafe/);
  });
  it("completes real TLS with explicit fixture trust and rejects hostname drift", async () => {
    const server = createServer(
      { key: fixture.key, cert: fixture.certificate },
      (_req, response) => response.end('{"status":"ok"}'),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as { port: number }).port;
    const get = (servername: string) =>
      new Promise<string>((resolve, reject) => {
        const call = request(
          { hostname: "127.0.0.1", port, servername, ca: fixture.certificate },
          (response) => {
            let text = "";
            response.on("data", (chunk: Buffer) => (text += chunk.toString()));
            response.on("end", () => resolve(text));
          },
        );
        call.on("error", reject);
        call.end();
      });
    try {
      expect(await get("localhost")).toBe('{"status":"ok"}');
      await expect(get("wrong.test")).rejects.toThrow(/Hostname/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
