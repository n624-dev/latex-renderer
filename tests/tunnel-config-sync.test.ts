import { describe, expect, it } from "vitest";
import {
  desiredLatexRoutes,
  reconcileLatexRoutes,
} from "../deploy/scripts/sync-cloudflare-tunnel-config.mjs";

describe("remote Cloudflare Tunnel reconciliation", () => {
  const hostname = "latex.example.com";
  const legacyHostnames: [string, string] = [
    "latex-admin.example.com",
    "latex-internal.example.com",
  ];
  const options = { hostname, legacyHostnames };

  it("replaces canonical routes, removes legacy hosts, and preserves route position", () => {
    const ingress = [
      { hostname: "unrelated.example.com", service: "ssh://127.0.0.1:22" },
      { hostname, service: "http://127.0.0.1:3100" },
      { hostname: legacyHostnames[0], service: "http://127.0.0.1:3101" },
      { hostname: legacyHostnames[1], service: "http://127.0.0.1:3103" },
      { service: "http_status:404" },
    ];
    expect(reconcileLatexRoutes(ingress, options)).toEqual([
      ingress[0],
      ...desiredLatexRoutes(hostname),
      ingress[4],
    ]);
  });

  it("collapses drifted canonical routes without changing unrelated rules", () => {
    const ingress = [
      { hostname: "unrelated.example", service: "http://127.0.0.1:1" },
      { hostname, path: "^/wrong$", service: "http://127.0.0.1:9" },
      { hostname, service: "http://127.0.0.1:8" },
      { service: "http_status:404" },
    ];
    expect(reconcileLatexRoutes(ingress, options)).toEqual([
      ingress[0],
      ...desiredLatexRoutes(hostname),
      ingress[3],
    ]);
  });

  it("refuses to create routes in an unexpected tunnel", () => {
    expect(() =>
      reconcileLatexRoutes([{ service: "http_status:404" }], options),
    ).toThrow(`no ${hostname} route`);
  });

  it("routes only bounded public health paths to the passive listener and supports rollback", () => {
    const routes = desiredLatexRoutes(hostname, { passiveHealth: true });
    expect(routes.slice(1)).toEqual(desiredLatexRoutes(hostname));
    expect(routes[0]?.service).toBe("unix:/run/latex-renderer-status/status.sock");
    const path = new RegExp(routes[0]?.path ?? "^$");
    for (const target of ["/health", "/health/rendering", "/health/status", "/api/v1/health"])
      expect(path.test(target)).toBe(true);
    for (const target of ["/health/secrets", "/api/v1/jobs", "/sources", "/mcp", "/admin", "/"])
      expect(path.test(target)).toBe(false);
    const ingress = [...routes, { service: "http_status:404" }];
    expect(reconcileLatexRoutes(ingress, { ...options, passiveHealth: true })).toEqual(ingress);
    expect(reconcileLatexRoutes(ingress, options)).toEqual([...desiredLatexRoutes(hostname), { service: "http_status:404" }]);
  });
});
