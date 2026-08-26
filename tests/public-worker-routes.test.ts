import { describe, expect, it } from "vitest";
import {
  desiredPublicWorkerPatterns,
  planPublicWorkerRoutes,
} from "../deploy/scripts/sync-public-worker-routes.mjs";

describe("public Worker Route reconciliation", () => {
  const hostname = "latex.example.com";
  const script = "latex-renderer-public-web";
  const patterns = desiredPublicWorkerPatterns(hostname);
  const options = { patterns, script };

  it("adds only the explicit public paths and preserves unrelated routes", () => {
    const gateway = {
      id: "gateway",
      pattern: `${hostname}/api/v1/render-tickets`,
      script: "latex-renderer-gateway",
    };
    const plan = planPublicWorkerRoutes([gateway], options);

    expect(plan.create).toEqual(patterns);
    expect(plan.remove).toEqual([]);
    expect(plan.create).not.toContain(`${hostname}/*`);
  });

  it("removes drift owned by the public Worker without touching Gateway routes", () => {
    const stale = {
      id: "stale",
      pattern: `${hostname}/old-public/*`,
      script,
    };
    const gateway = {
      id: "gateway",
      pattern: `${hostname}/api/v1/health`,
      script: "latex-renderer-gateway",
    };
    const existing = patterns.map((pattern, index) => ({
      id: String(index),
      pattern,
      script,
    }));

    expect(
      planPublicWorkerRoutes([...existing, stale, gateway], options),
    ).toEqual({
      create: [],
      remove: [stale],
    });
  });

  it("refuses to replace a route assigned to another Worker", () => {
    expect(() =>
      planPublicWorkerRoutes(
        [
          {
            id: "conflict",
            pattern: `${hostname}/`,
            script: "someone-else",
          },
        ],
        options,
      ),
    ).toThrow("owned by another script");
  });

  it("plans a reversible rollback for only the public Worker", () => {
    const publicRoute = {
      id: "public",
      pattern: `${hostname}/`,
      script,
    };
    const gateway = {
      id: "gateway",
      pattern: `${hostname}/api/v1/health`,
      script: "latex-renderer-gateway",
    };

    expect(
      planPublicWorkerRoutes([publicRoute, gateway], {
        ...options,
        enabled: false,
      }),
    ).toEqual({
      create: [],
      remove: [publicRoute],
    });
  });
});
