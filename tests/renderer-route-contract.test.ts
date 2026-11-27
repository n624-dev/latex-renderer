import { describe, expect, it } from "vitest";
import { createRendererApp } from "../apps/renderer-api/src/app.js";
import { createRendererV1Router } from "../apps/renderer-api/src/routes/index.js";
import { gatewayRoute } from "../packages/gateway-core/src/index.js";
import {
  normalizedRoute,
  openApiOperations,
} from "./helpers/http-route-contract.js";

describe("renderer route contract", () => {
  it("matches the documented public Renderer routes in both directions", () => {
    const actual = createRendererV1Router({} as never)
      .routes.map(
        ({ method, path }) => `${method} /api/v1${normalizedRoute(path)}`,
      )
      .sort();
    const expected = openApiOperations("openapi/renderer.openapi.yaml")
      .map(({ method, path }) => `${method} ${normalizedRoute(path)}`)
      .sort();
    expect(actual).toEqual(expected);
  });

  it("routes every documented Gateway operation at the canonical path", () => {
    const ids: Record<string, string> = {
      projectId: `project_${"a".repeat(32)}`,
      revisionId: `revision_${"b".repeat(32)}`,
      jobId: `job_${"c".repeat(32)}`,
    };
    for (const { method, path } of openApiOperations(
      "openapi/gateway.openapi.yaml",
    )) {
      const route = gatewayRoute(
        path.replace(
          /\{([^}]+)\}/g,
          (_, name: string) => ids[name] ?? "fixture",
        ),
        method,
      );
      expect(route, `${method} ${path}`).not.toBeUndefined();
      expect(route, `${method} ${path}`).not.toBe("method-not-allowed");
      expect(route, `${method} ${path}`).not.toBe("invalid-job");
    }
    expect(gatewayRoute("/internal/v1/source-tickets", "POST")).toBeUndefined();
  });
  it("supports canonical and legacy prefixes", async () => {
    const app = createRendererApp({
      database: {} as never,
      tickets: {} as never,
      storageRoot: "/tmp",
      maxUploadBytes: 1,
      minFreeStorageBytes: 1,
      artifactRetentionHours: 24,
    });
    for (const path of ["/api/v1/jobs/not-a-job", "/v1/jobs/not-a-job"]) {
      const response = await app.request(path);
      expect(response.status).toBe(400);
    }
  });
  it("does not expose client distribution from renderer API", async () => {
    const app = createRendererApp({
      database: {} as never,
      tickets: {} as never,
      storageRoot: "/tmp",
      maxUploadBytes: 1,
      minFreeStorageBytes: 1,
      artifactRetentionHours: 24,
    });
    expect((await app.request("/client/")).status).toBe(404);
  });
});
