import { once } from "node:events";
import { createServer, request } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import {
  renderLanHttpsBackendNginx,
  renderServerIngressNginx,
} from "../packages/server-setup-core/src/index.mjs";
const provider = {
  format: 1,
  provider: "akebi-local-acme",
  keylessFallback: true,
  serverOrigin: "https://akebi.example.test",
  lanDomain: "lan.example.test",
  address: "192.168.1.50",
};
const review = {
  format: 1,
  mode: "standalone",
  tlsProvider: "automatic",
  accessScope: "lan",
  publicOrigin: "https://192-168-1-50.lan.example.test",
  listenAddress: "192.168.1.50",
  allowedNetworks: ["192.168.1.0/24"],
  lanHttps: { format: 1, provider, issuerId: "zerossl", termsAccepted: true },
};
const nginx = spawnSync("nginx", ["-v"], { timeout: 3000 });
if (process.env.CI === "true" && nginx.status !== 0)
  throw new Error("CI requires nginx for actual LAN backend tests");
function locations(config: string) {
  return config
    .split("\n")
    .filter((line) => line.trim().startsWith("location "));
}

describe("loopback backend behind LAN TLS bridge", () => {
  it("preserves existing routing and only trusts the explicit loopback peer handoff", () => {
    const config = renderLanHttpsBackendNginx(review, provider);
    expect(config).toContain("listen 127.0.0.1:3180;");
    expect(config).not.toMatch(/listen .*ssl|ssl_certificate|listen 192/);
    expect(config).toContain("real_ip_header X-Latex-Renderer-Lan-Peer;");
    expect(config).toContain("geo $remote_addr");
    expect(config).toContain(
      "proxy_set_header X-Latex-Renderer-Client-IP $remote_addr;",
    );
    expect(config).toContain("proxy_set_header X-Forwarded-Proto https;");
    expect(locations(config)).toEqual(
      locations(
        renderServerIngressNginx({
          ...Object.fromEntries(
            Object.entries(review).filter(([key]) => key !== "lanHttps"),
          ),
          tlsProvider: "custom",
        }),
      ),
    );
    expect(() =>
      renderLanHttpsBackendNginx(
        { ...review, publicOrigin: "https://other.example.test" },
        provider,
      ),
    ).toThrow(/match/);
    expect(() =>
      renderLanHttpsBackendNginx(
        { ...review, accessScope: "internet" },
        provider,
      ),
    ).toThrow();
    expect(() =>
      renderLanHttpsBackendNginx(
        { ...review, listenAddress: "192.168.1.51" },
        provider,
      ),
    ).toThrow(/match/);
    expect(() => renderServerIngressNginx(review)).toThrow();
  });
  it.skipIf(nginx.status !== 0)(
    "serves the generated Nginx backend with actual peer ACLs and overwritten identity headers",
    async () => {
      const root = mkdtempSync(join(tmpdir(), "lan-nginx-backend-"));
      const upstream = createServer((r, w) => {
        w.setHeader("content-type", "application/json");
        w.end(JSON.stringify(r.headers));
      });
      upstream.listen(0, "127.0.0.1");
      await once(upstream, "listening");
      const upstreamPort = (upstream.address() as { port: number }).port;
      const temporary = createServer();
      temporary.listen(0, "127.0.0.1");
      await once(temporary, "listening");
      const port = (temporary.address() as { port: number }).port;
      await new Promise<void>((resolve) => temporary.close(() => resolve()));
      let child: ReturnType<typeof spawn> | undefined;
      const get = (headers: Record<string, string>) =>
        new Promise<{ status: number; headers: Record<string, string> }>(
          (resolve, reject) => {
            const call = request(
              {
                host: "127.0.0.1",
                port,
                path: "/api/v1/lan-fixture",
                agent: false,
                timeout: 2000,
                headers: { Host: "192-168-1-50.lan.example.test", ...headers },
              },
              (response) => {
                let body = "";
                response.setEncoding("utf8");
                response.on("data", (chunk: string) => {
                  body += chunk;
                });
                response.on("end", () => {
                  try {
                    resolve({
                      status: response.statusCode ?? 0,
                      headers:
                        response.statusCode === 200
                          ? (JSON.parse(body) as Record<string, string>)
                          : {},
                    });
                  } catch (error) {
                    reject(
                      error instanceof Error
                        ? error
                        : new Error("Invalid fixture backend response"),
                    );
                  }
                });
              },
            );
            call.on("error", reject);
            call.on("timeout", () =>
              call.destroy(new Error("fixture deadline")),
            );
            call.end();
          },
        );
      try {
        const generated = renderLanHttpsBackendNginx(review, provider)
          .replace("listen 127.0.0.1:3180;", `listen 127.0.0.1:${port};`)
          .replace(
            /http:\/\/127\.0\.0\.1:310[0-5]/g,
            `http://127.0.0.1:${upstreamPort}`,
          );
        const path = join(root, "nginx.conf");
        writeFileSync(
          path,
          `daemon off; master_process off; pid ${root}/pid; error_log stderr error; events {} http { access_log off; client_body_temp_path ${root}/body; proxy_temp_path ${root}/proxy; set_real_ip_from 127.0.0.1; real_ip_header X-Forwarded-For; ${generated} }`,
        );
        const check = spawnSync("nginx", ["-t", "-p", root, "-c", path], {
          encoding: "utf8",
          timeout: 5000,
        });
        expect(check.stderr).not.toMatch(/\[emerg\]/);
        expect(check.status).toBe(0);
        child = spawn("nginx", ["-p", root, "-c", path], { stdio: "ignore" });
        let ready = false;
        for (let i = 0; i < 40; i++) {
          try {
            ready =
              (await get({ "X-Latex-Renderer-Lan-Peer": "192.168.1.42" }))
                .status === 200;
            if (ready) break;
          } catch {
            /* bounded startup */
          }
          if (child.exitCode !== null) break;
          await delay(25);
        }
        expect(ready).toBe(true);
        const result = await get({
          "X-Latex-Renderer-Lan-Peer": "192.168.1.42",
          "X-Forwarded-For": "8.8.8.8",
          "X-Latex-Renderer-Client-IP": "8.8.4.4",
          Forwarded: "for=8.8.8.8",
          Authorization: "Bearer fixture-only",
        });
        expect(result.status).toBe(200);
        expect(result.headers["x-latex-renderer-client-ip"]).toBe(
          "192.168.1.42",
        );
        expect(result.headers["x-forwarded-for"]).toBe("192.168.1.42");
        expect(result.headers["x-forwarded-proto"]).toBe("https");
        expect(result.headers.authorization).toBe("Bearer fixture-only");
        expect(result.headers.forwarded).toBeUndefined();
        expect((await get({})).status).toBe(403);
        expect(
          (await get({ "X-Latex-Renderer-Lan-Peer": "10.0.0.42" })).status,
        ).toBe(403);
        expect(
          (await get({ "X-Latex-Renderer-Lan-Peer": "192.168.1.42, 8.8.8.8" }))
            .status,
        ).toBe(403);
      } finally {
        if (child && child.exitCode === null) {
          const exited = once(child, "exit");
          child.kill("SIGTERM");
          await exited;
        }
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
        rmSync(root, { recursive: true, force: true });
      }
    },
  );
});
