import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer as httpServer } from "node:http";
import { createServer as tcpServer } from "node:net";
import { request } from "node:https";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { renderServerIngressNginx } from "../packages/server-setup-core/src/index.mjs";
import { ingressTlsFixture } from "./fixtures/server-ingress.js";

const local = {
  format: 1,
  mode: "standalone",
  publicOrigin: "https://localhost:8443",
  accessScope: "local",
  tlsProvider: "custom",
  listenAddress: "127.0.0.1",
};
const nginx = spawnSync("nginx", ["-v"], { timeout: 3000 });
if (process.env.CI === "true" && nginx.status !== 0)
  throw new Error("CI requires nginx for actual scoped ingress tests");
const hasNginx = nginx.status === 0;

async function availablePort() {
  const server = tcpServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

describe("standalone Nginx configuration and actual HTTPS proxy", () => {
  it("binds only the selected HTTPS address, keeps all loopback routes/limits and the non-default origin port", () => {
    const config = renderServerIngressNginx(local);
    expect(config).toContain("listen 127.0.0.1:8443 ssl http2;");
    expect(config).not.toMatch(
      /listen 80|listen 443|proxy_pass https|noTLSVerify/,
    );
    expect(config).toContain("proxy_set_header Host localhost:8443;");
    expect(config).toContain(
      "proxy_set_header X-Forwarded-Host localhost:8443;",
    );
    expect(config).toContain("geo $realip_remote_addr");
    expect(config).toContain(
      "proxy_set_header X-Latex-Renderer-Client-IP $realip_remote_addr;",
    );
    expect(config).toContain("ssl_protocols TLSv1.2 TLSv1.3;");
    const existing = readFileSync(
      new URL("../deploy/reverse-proxy/nginx.conf.example", import.meta.url),
      "utf8",
    );
    const routes = (value: string) =>
      value
        .split("\n")
        .filter((line) => line.trim().startsWith("location "))
        .map((line) => line.trim());
    expect(routes(config)).toEqual(routes(existing));
    expect(
      renderServerIngressNginx({
        ...local,
        listenAddress: "::1",
        publicOrigin: "https://[::1]:8443",
      }),
    ).toContain("listen [::1]:8443 ssl http2;");
    expect(() =>
      renderServerIngressNginx({
        ...local,
        publicOrigin: "https://unsafe;host.test",
      }),
    ).toThrow(/DNS|safely/);
  });
  it.skipIf(!hasNginx)(
    "validates and serves the generated config, rejecting spoofed headers, wrong hosts and unavailable upstreams",
    async () => {
      const fixture = ingressTlsFixture();
      const root = mkdtempSync(join(tmpdir(), "renderer-ingress-nginx-"));
      const upstream = httpServer((req, res) => {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({ status: "ok", path: req.url, headers: req.headers }),
        );
      });
      upstream.listen(0, "127.0.0.1");
      await once(upstream, "listening");
      const upstreamPort = (upstream.address() as { port: number }).port;
      const port = await availablePort();
      let child: ReturnType<typeof spawn> | undefined;
      try {
        let config = renderServerIngressNginx({
          ...local,
          publicOrigin: `https://localhost:${port}`,
        });
        config = config
          .replaceAll(
            "/etc/latex-renderer/secrets/https-cert.pem",
            fixture.certificatePath,
          )
          .replaceAll(
            "/etc/latex-renderer/secrets/https-key.pem",
            fixture.keyPath,
          )
          .replace(
            /http:\/\/127\.0\.0\.1:310[0-5]/g,
            `http://127.0.0.1:${upstreamPort}`,
          );
        const path = join(root, "nginx.conf");
        writeFileSync(
          path,
          `daemon off; master_process off; pid ${root}/pid; error_log stderr error; events {} http { access_log off; client_body_temp_path ${root}/body; proxy_temp_path ${root}/proxy; set_real_ip_from 127.0.0.1; real_ip_header X-Forwarded-For; ${config} }`,
        );
        const checked = spawnSync("nginx", ["-t", "-p", root, "-c", path], {
          encoding: "utf8",
          timeout: 5000,
        });
        expect(checked.stderr).not.toMatch(/\[emerg\]/);
        expect(checked.status).toBe(0);
        child = spawn("nginx", ["-p", root, "-c", path], { stdio: "ignore" });
        const get = (
          headers: Record<string, string> = {},
          route = "/api/v1/health",
        ) =>
          new Promise<{ status: number; body: string }>((resolve, reject) => {
            const call = request(
              {
                hostname: "127.0.0.1",
                servername: "localhost",
                port,
                ca: fixture.certificate,
                path: route,
                headers: { Host: `localhost:${port}`, ...headers },
                agent: false,
                timeout: 2000,
              },
              (response) => {
                let body = "";
                response.on(
                  "data",
                  (chunk: Buffer) => (body += chunk.toString()),
                );
                response.on("end", () =>
                  resolve({ status: response.statusCode ?? 0, body }),
                );
              },
            );
            call.on("error", reject);
            call.on("timeout", () =>
              call.destroy(new Error("fixture request timeout")),
            );
            call.end();
          });
        let ready = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          try {
            ready = (await get()).status === 200;
            if (ready) break;
          } catch {
            /* bounded fixture startup */
          }
          if (child.exitCode !== null) break;
          await delay(20);
        }
        expect(ready).toBe(true);
        const result = await get({
          "X-Forwarded-For": "203.0.113.5",
          "X-Latex-Renderer-Client-IP": "10.2.3.4",
          Forwarded: "for=10.2.3.4",
          "CF-Access-Jwt-Assertion": "fixture-fake-jwt",
          "CF-Connecting-IP": "10.2.3.4",
        });
        expect(result.status).toBe(200);
        const { headers } = JSON.parse(result.body) as {
          headers: Record<string, string | undefined>;
        };
        expect(headers.host).toBe(`localhost:${port}`);
        expect(headers["x-forwarded-host"]).toBe(`localhost:${port}`);
        expect(headers["x-forwarded-proto"]).toBe("https");
        expect(headers["x-forwarded-for"]).toBe("127.0.0.1");
        expect(headers["x-latex-renderer-client-ip"]).toBe("127.0.0.1");
        expect(headers.forwarded).toBeUndefined();
        expect(headers["cf-access-jwt-assertion"]).toBeUndefined();
        expect(headers["cf-connecting-ip"]).toBeUndefined();
        expect((await get({ Host: "wrong.test" })).status).toBe(421);
        // The host health adapter uses normal CA trust, not rejectUnauthorized=false.
        const code = `import {checkIngressHttpsHealth} from ${JSON.stringify(new URL("../deploy/scripts/server-ingress.mjs", import.meta.url).href)};await checkIngressHttpsHealth(process.argv[1]);`;
        const healthy = spawn(
          process.execPath,
          ["--input-type=module", "-e", code, `https://localhost:${port}`],
          {
            env: {
              ...process.env,
              NODE_EXTRA_CA_CERTS: fixture.certificatePath,
            },
            stdio: "ignore",
          },
        );
        expect((await once(healthy, "exit"))[0]).toBe(0);
        const check = spawn(
          process.execPath,
          ["--input-type=module", "-e", code, `https://127.0.0.1:${port}`],
          {
            env: {
              ...process.env,
              NODE_EXTRA_CA_CERTS: fixture.certificatePath,
            },
            stdio: "ignore",
          },
        );
        // This IP-origin intentionally fails the generated DNS Host check.
        expect((await once(check, "exit"))[0]).not.toBe(0);
        const untrustedEnv = { ...process.env };
        delete untrustedEnv.NODE_EXTRA_CA_CERTS;
        const untrusted = spawn(
          process.execPath,
          ["--input-type=module", "-e", code, `https://localhost:${port}`],
          { env: untrustedEnv, stdio: "ignore" },
        );
        expect((await once(untrusted, "exit"))[0]).not.toBe(0);
        const conflict = spawnSync("nginx", ["-p", root, "-c", path], {
          encoding: "utf8",
          timeout: 5000,
        });
        expect(conflict.error).toBeUndefined();
        expect(conflict.status).not.toBe(0);
        expect(conflict.stderr).toMatch(/bind.*failed/);
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
        expect((await get()).status).toBe(502);
        // Prove LAN denial is not bypassed by an inherited realip configuration.
        child.kill("SIGTERM");
        await once(child, "exit");
        const lan = renderServerIngressNginx({
          ...local,
          publicOrigin: `https://localhost:${port}`,
          accessScope: "lan",
          listenAddress: "10.1.2.3",
          allowedNetworks: ["10.0.0.0/8"],
        })
          .replace(`listen 10.1.2.3:${port}`, `listen 127.0.0.1:${port}`)
          .replaceAll(
            "/etc/latex-renderer/secrets/https-cert.pem",
            fixture.certificatePath,
          )
          .replaceAll(
            "/etc/latex-renderer/secrets/https-key.pem",
            fixture.keyPath,
          );
        writeFileSync(
          path,
          `daemon off; master_process off; pid ${root}/pid; error_log stderr error; events {} http { access_log off; set_real_ip_from 127.0.0.1; real_ip_header X-Forwarded-For; ${lan} }`,
        );
        child = spawn("nginx", ["-p", root, "-c", path], { stdio: "ignore" });
        let denied = false;
        for (let attempt = 0; attempt < 50; attempt++) {
          try {
            denied =
              (await get({ "X-Forwarded-For": "10.1.2.3" })).status === 403;
            if (denied) break;
          } catch {
            /* bounded startup */
          }
          if (child.exitCode !== null) break;
          await delay(20);
        }
        expect(denied).toBe(true);
      } finally {
        if (child && child.exitCode === null) {
          child.kill("SIGTERM");
          await once(child, "exit");
        }
        upstream.closeAllConnections();
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
        fixture.cleanup();
        rmSync(root, { recursive: true, force: true });
      }
    },
    20000,
  );
});
