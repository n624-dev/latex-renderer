import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFile, execFileSync, spawn } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
  lstatSync,
} from "node:fs";
import { tmpdir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { createServer, request as requestHttps } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { lanCertificateFixture } from "./fixtures/lan-https.js";
import { lanHttpsInterfaceChoices } from "../packages/server-setup-core/src/lan-https.mjs";
import { withLanHttpsClientLock } from "../deploy/lan-https/client-state.mjs";
import { request } from "node:http";
import { once } from "node:events";
import { ingressTlsFixture } from "./fixtures/server-ingress.js";
import {
  initializeLanHttpsAuthority,
  startLanHttpsAuthority,
  withLanHttpsAuthorityStore,
} from "../deploy/lan-https/authority-runtime.mjs";
import { withLanHttpsProfile } from "../deploy/lan-https/profiles.mjs";
import { validateLanHttpsClientConfiguration } from "../deploy/lan-https/configuration.mjs";
const execute = promisify(execFile);
const enabled =
  process.platform === "linux" &&
  (process.env.CI_LAN_HTTPS_NATIVE === "1" ||
    process.env.LAN_HTTPS_GO !== undefined);
const go = process.env.LAN_HTTPS_GO ?? "go";
let root = "",
  binary = "";
beforeAll(async () => {
  if (!enabled) return;
  root = mkdtempSync(join(tmpdir(), "lan-native-protocol-"));
  binary = join(root, "lan-https");
  await execute(
    go,
    ["build", "-p", "1", "-trimpath", "-o", binary, "./cmd/lan-https"],
    {
      cwd: resolve("deploy/lan-https/bridge"),
      timeout: 120000,
      env: {
        ...process.env,
        GOTOOLCHAIN: "local",
        GOMAXPROCS: "1",
        GOMEMLIMIT: "160MiB",
        GOGC: "30",
      },
    },
  );
  const metadata = lstatSync(binary);
  if (metadata.nlink !== 1)
    throw new Error(`Fixture executable link count ${metadata.nlink}`);
  chmodSync(binary, 0o755);
}, 120000);
afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe.skipIf(!enabled)(
  "native Go signer and Node authority protocol",
  () => {
    it("authenticates Go requests through real HTTPS and verifies a real ECDSA signature from the isolated signer; revocation rejects reuse", async () => {
      const api = ingressTlsFixture();
      const ca = ingressTlsFixture({ ca: true });
      const caseRoot = mkdtempSync(join(root, "case-"));
      const authorityRoot = join(caseRoot, "authority");
      const stateRoot = join(caseRoot, "client");
      const keyPath = join(caseRoot, "wildcard.key"),
        csrPath = join(caseRoot, "wildcard.csr"),
        certPath = join(caseRoot, "wildcard.pem"),
        bundlePath = join(caseRoot, "bundle.pem");
      execFileSync(
        "openssl",
        [
          "req",
          "-new",
          "-newkey",
          "ec",
          "-pkeyopt",
          "ec_paramgen_curve:prime256v1",
          "-nodes",
          "-subj",
          "/CN=fixture",
          "-addext",
          "subjectAltName=DNS:*.lan.example.test",
          "-keyout",
          keyPath,
          "-out",
          csrPath,
        ],
        { stdio: "ignore", timeout: 10000 },
      );
      execFileSync(
        "openssl",
        [
          "x509",
          "-req",
          "-CA",
          ca.certificatePath,
          "-CAkey",
          ca.keyPath,
          "-set_serial",
          "77",
          "-days",
          "1",
          "-copy_extensions",
          "copy",
          "-in",
          csrPath,
          "-out",
          certPath,
        ],
        { stdio: "ignore", timeout: 10000 },
      );
      writeFileSync(
        bundlePath,
        Buffer.concat([
          readFileSync(keyPath),
          readFileSync(certPath),
          ca.certificate,
        ]),
        { mode: 0o600 },
      );
      const rootsPath = join(caseRoot, "roots.pem");
      writeFileSync(
        rootsPath,
        Buffer.concat([api.certificate, ca.certificate]),
        { mode: 0o600 },
      );
      vi.stubEnv("SSL_CERT_FILE", rootsPath);
      let httpPort = 0;
      const https = createServer(
        { cert: api.certificate, key: api.key, minVersion: "TLSv1.2" },
        (incoming, outgoing) => {
          const call = request(
            {
              hostname: "127.0.0.1",
              port: httpPort,
              path: incoming.url,
              method: incoming.method,
              headers: incoming.headers,
              agent: false,
            },
            (response) => {
              outgoing.writeHead(response.statusCode ?? 500, response.headers);
              response.pipe(outgoing);
            },
          );
          call.on("error", () => {
            outgoing.statusCode = 503;
            outgoing.end();
          });
          incoming.pipe(call);
        },
      );
      https.listen(0, "127.0.0.1");
      await once(https, "listening");
      const tlsPort = (https.address() as { port: number }).port;
      const origin = `https://127.0.0.1:${tlsPort}`;
      const config = {
        format: 1,
        role: "authority",
        stateDirectory: authorityRoot,
        policy: {
          format: 1,
          registration: "open",
          serverOrigin: origin,
          lanDomain: "lan.example.test",
        },
        http: { address: "127.0.0.1", port: 3181, trustLoopbackProxy: false },
        dns: {
          listeners: [{ address: "127.0.0.1", port: 53 }],
          nameserver: "ns1.example.test",
          caaIssuers: ["letsencrypt.org"],
        },
        issuers: [
          {
            id: "letsencrypt",
            directoryUrl: "https://acme.example.test/directory",
            newAccountUrl: "https://acme.example.test/newAccount",
          },
        ],
        keyless: { binary, bundleFile: bundlePath },
      };
      initializeLanHttpsAuthority(config);
      const service = await startLanHttpsAuthority(
        {
          ...config,
          http: { ...config.http, port: 0 },
          dns: {
            ...config.dns,
            listeners: [{ address: "127.0.0.1", port: 0 }],
          },
        },
        { allowEphemeral: true },
      );
      httpPort = service.httpPort;
      try {
        const clientPath = join(caseRoot, "client.json");
        writeFileSync(
          clientPath,
          JSON.stringify({
            format: 1,
            role: "client",
            stateDirectory: stateRoot,
            provider: {
              format: 1,
              provider: "akebi-keyless",
              serverOrigin: origin,
              lanDomain: "lan.example.test",
              address: "192.168.1.50",
              keylessFallback: true,
            },
            allowedNetworks: ["192.168.1.0/24"],
            issuerId: "letsencrypt",
            termsAccepted: false,
          }),
          { mode: 0o600 },
        );
        await withLanHttpsProfile(
          validateLanHttpsClientConfiguration(
            JSON.parse(readFileSync(clientPath, "utf8")),
          ),
          () => Promise.resolve(),
        );
        const result = await execute(
          binary,
          ["keyless-check", "--config", clientPath],
          {
            timeout: 20000,
            env: {
              PATH: process.env.PATH,
              SSL_CERT_FILE: rootsPath,
              GOMAXPROCS: "1",
              GOMEMLIMIT: "48MiB",
            },
          },
        );
        const value = JSON.parse(result.stdout) as {
          keylessReady: boolean;
          installationId: string;
        };
        expect(value.keylessReady).toBe(true);
        expect(value.installationId).toMatch(/^[a-f0-9]{64}$/);
        withLanHttpsAuthorityStore(config, (store) =>
          store.revokeInstallation(value.installationId),
        );
        await expect(
          execute(binary, ["keyless-check", "--config", clientPath], {
            timeout: 20000,
            env: {
              PATH: process.env.PATH,
              SSL_CERT_FILE: rootsPath,
              GOMAXPROCS: "1",
              GOMEMLIMIT: "48MiB",
            },
          }),
        ).rejects.toMatchObject({ code: 1 });
      } finally {
        await service.close();
        https.closeAllConnections();
        await new Promise<void>((resolve) => https.close(() => resolve()));
        api.cleanup();
        ca.cleanup();
      }
    }, 45000);
  },
);

it.skipIf(!enabled)(
  "serves a real offline local certificate through the native frontend and protects its profile from GC",
  async (context) => {
    const entry = lanHttpsInterfaceChoices(networkInterfaces()).find(
      (candidate) => !candidate.address.includes(":"),
    );
    if (!entry) {
      context.skip();
      return;
    }
    const backend = createHttpServer((request, response) => {
      response.end(
        JSON.stringify({ peer: request.headers["x-latex-renderer-lan-peer"] }),
      );
    });
    try {
      await new Promise<void>((resolve, reject) => {
        backend.once("error", reject);
        backend.listen(3180, "127.0.0.1", resolve);
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        context.skip();
        return;
      }
      throw error;
    }
    let cleanup: () => void = () => {};
    try {
      const allocation = createNetServer();
      allocation.listen(0, entry.address);
      await once(allocation, "listening");
      const port = (allocation.address() as { port: number }).port;
      await new Promise<void>((resolve) => allocation.close(() => resolve()));
      const stateDirectory = join(root, "offline-client");
      const config = validateLanHttpsClientConfiguration({
        format: 1,
        role: "client",
        stateDirectory,
        provider: {
          format: 1,
          provider: "akebi-local-acme",
          serverOrigin: "https://akebi.example.test",
          lanDomain: "lan.example.test",
          address: entry.address,
          port,
          keylessFallback: false,
        },
        issuerId: "ca",
        termsAccepted: true,
        allowedNetworks: [entry.network],
      });
      const client = await withLanHttpsProfile(config, (c) => ({
        id: c.installationId,
        tlsKey: c.state.ensureKeys().tlsKey,
        profileRoot: c.profileRoot,
      }));
      const profileRoot = client.profileRoot;
      const issued = await lanCertificateFixture({
        installationId: client.id,
        address: entry.address,
        tlsKey: client.tlsKey.toString(),
      });
      cleanup = issued.cleanup;
      await withLanHttpsProfile(config, async (c) => {
        await c.state.installCertificate(issued.certificate, {
          hostnames: issued.request.hostnames,
          trustedCertificates: [issued.root.certificate.toString()],
        });
      });
      const configPath = join(root, "offline.json"),
        rootsPath = join(root, "offline-ca.pem");
      writeFileSync(configPath, JSON.stringify(config), { mode: 0o600 });
      writeFileSync(rootsPath, issued.root.certificate, { mode: 0o600 });
      const child = spawn(binary, ["front", "--config", configPath], {
        stdio: ["ignore", "ignore", "pipe"],
        env: {
          PATH: process.env.PATH,
          SSL_CERT_FILE: rootsPath,
          GOMAXPROCS: "1",
          GOMEMLIMIT: "48MiB",
        },
      });
      const exited = once(child, "exit");
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Frontend readiness deadline")),
            10000,
          );
          let output = "";
          child.stderr.on("data", (chunk: Buffer) => {
            output += chunk.toString();
            if (output.includes("lan_https.front_started")) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.once("exit", () => {
            clearTimeout(timer);
            reject(new Error("Native frontend exited before readiness"));
          });
        });
        const body = await new Promise<string>((resolve, reject) => {
          const req = requestHttps(
            {
              hostname: entry.address,
              port,
              servername: new URL(config.provider.publicOrigin).hostname,
              headers: {
                Host: new URL(config.provider.publicOrigin).host,
                "X-Latex-Renderer-Lan-Peer": "attacker",
              },
              ca: issued.root.certificate,
              agent: false,
            },
            (response) => {
              let data = "";
              response.setEncoding("utf8");
              response.on("data", (chunk: string) => {
                data += chunk;
              });
              response.on("end", () => resolve(data));
            },
          );
          req.on("error", reject);
          req.setTimeout(5000, () =>
            req.destroy(new Error("TLS fixture timeout")),
          );
          req.end();
        });
        expect(JSON.parse(body)).toEqual({ peer: entry.address });
        await expect(
          withLanHttpsClientLock(profileRoot, () => Promise.resolve(), {
            lockFile: "serve.lock",
          }),
        ).rejects.toThrow(/publisher is busy/);
      } finally {
        if (child.exitCode === null) child.kill("SIGTERM");
        await exited;
      }
      await withLanHttpsClientLock(profileRoot, () => Promise.resolve(), {
        lockFile: "serve.lock",
      });
    } finally {
      backend.closeAllConnections();
      await new Promise<void>((resolve) => backend.close(() => resolve()));
      cleanup();
    }
  },
  45000,
);
