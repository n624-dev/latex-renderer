import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@latex-renderer/shared";
import { createAdminApp } from "../apps/admin-api/src/app.js";

describe("admin route contract", () => {
  it("serves canonical and compatibility prefixes", async () => {
    const app = createAdminApp({
      database: { users: {} } as never,
      apiKeys: {} as never,
      browserAuth: {
        authenticate: () =>
          Promise.resolve({
            user: { id: "missing", role: "user", status: "active" },
            authMode: "cloudflare-access",
          }),
      } as never,
      deploymentMode: "cloudflare",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(["https://latex.example.com"]),
      writeEnabled: true,
      storageRoot: "/tmp",
      rendererVersion: "test",
      maxOutputBytes: 1,
      maxQueueLength: 1,
      maxUserStorageBytes: 1,
      minFreeStorageBytes: 1,
      activeTicketKid: "v2",
      verificationTicketKids: ["v1"],
    });

    for (const path of ["/admin/api/v1/me", "/admin/v1/me"]) {
      const response = await app.request(path, {
        headers: { "Cf-Access-Jwt-Assertion": "test" },
      });
      expect(response.status).toBe(403);
    }
  });

  it("rejects oversized administration bodies before route parsing", async () => {
    const app = createAdminApp({
      database: {} as never,
      apiKeys: {} as never,
      browserAuth: {} as never,
      deploymentMode: "standalone",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(["https://latex.example.com"]),
      writeEnabled: true,
      storageRoot: "/tmp",
      rendererVersion: "test",
      maxOutputBytes: 1,
      maxQueueLength: 1,
      maxUserStorageBytes: 1,
      minFreeStorageBytes: 1,
      activeTicketKid: "v2",
      verificationTicketKids: ["v1"],
    });
    const response = await app.request("/admin/api/v1/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "x".repeat(64 * 1024 + 1),
    });
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "REQUEST_TOO_LARGE" },
    });
  });

  it("documents every required Admin mutation body in OpenAPI", () => {
    const document = readFileSync(
      resolve(process.cwd(), "openapi/admin.openapi.yaml"),
      "utf8",
    );
    for (const [path, schema] of [
      ["/service-accounts/{id}", "UpdateServiceAccount"],
      ["/jobs/source-tickets", "AdminSourceTicketRequest"],
      ["/jobs/bulk-delete", "BulkDeleteJobsRequest"],
      ["/sources/{id}/render", "SourceRenderRequest"],
      ["/sources/{id}/source-ref", "SourceReferenceRequest"],
      ["/system/config", "UpdateSystemConfigRequest"],
      ["/system/maintenance/enable", "EnableMaintenanceRequest"],
    ] as const) {
      const operation = openApiPathBlock(document, path);
      expect(operation, `${path} is present in OpenAPI`).toContain(
        "requestBody:",
      );
      expect(operation).toContain(`#/components/schemas/${schema}`);
    }
  });

  it("keeps the public Gateway OpenAPI aligned with runtime request bodies", () => {
    const document = readFileSync(
      resolve(process.cwd(), "openapi/gateway.openapi.yaml"),
      "utf8",
    );
    const renewal = openApiPathBlock(document, "/api/v1/job-tickets/{jobId}");
    expect(renewal).not.toContain("requestBody:");
    const sourceRequest = openApiPathBlock(document, "/api/v1/source-tickets");
    expect(sourceRequest).toContain("#/components/schemas/SourceTicketRequest");
    expect(sourceRequest).not.toContain("outputs:");
    const renderRequest = openApiPathBlock(document, "/api/v1/render-tickets");
    expect(renderRequest).toContain('"200":');
  });

  it("keeps application-update and TeX-environment authority separate from system scopes", () => {
    const root = resolve(process.cwd());
    const updates = readFileSync(
      resolve(root, "apps/admin-api/src/routes/updates.ts"),
      "utf8",
    );
    const tex = readFileSync(
      resolve(root, "apps/admin-api/src/routes/tex-environment.ts"),
      "utf8",
    );
    const contracts = readFileSync(
      resolve(root, "packages/contracts/src/index.ts"),
      "utf8",
    );
    const openapi = readFileSync(
      resolve(root, "openapi/admin.openapi.yaml"),
      "utf8",
    );

    expect(contracts).toContain('"admin:update:read"');
    expect(contracts).toContain('"admin:update:write"');
    expect(contracts).toContain('"admin:tex-environment:read"');
    expect(contracts).toContain('"admin:tex-environment:write"');
    expect(contracts).toContain("z.string().trim().min(1).max(500)");

    expect(updates).toContain('"admin:update:read"');
    expect(updates).toContain('"admin:update:write"');
    expect(updates).toContain("requireOwnerActor");
    expect(updates).toContain("adminMutationReasonSchema");
    expect(updates).toContain("{ reason: input.reason }");
    expect(updates).not.toContain('"admin:system:');
    expect(tex).toContain('"admin:tex-environment:read"');
    expect(tex).toContain('"admin:tex-environment:write"');
    expect(tex).toContain("requireOwnerActor");
    expect(tex).toContain("adminMutationReasonSchema");
    expect(tex).toContain("{ reason: input.reason }");
    expect(tex).not.toContain('"admin:system:');

    for (const path of [
      "/tex-environment/apply",
      "/tex-environment/rollback",
      "/tex-environment/revalidate",
      "/tex-environment/cleanup",
      "/tex-environment/refresh",
      "/updates/policy",
      "/updates/refresh",
      "/updates/apply",
      "/updates/rollback",
    ]) {
      const operation = openApiPathBlock(openapi, path);
      expect(operation).toContain("reason");
      expect(operation).toContain("owner actor");
    }
  });

  it("enforces dedicated mutation scopes, owner role, reason, and manager payloads at runtime", async () => {
    const audits: Array<Record<string, unknown>> = [];
    const updateApply = vi.fn((version?: string) => {
      void version;
      return Promise.resolve({ id: "updop_test" });
    });
    const imageApply = vi.fn((input: unknown) => {
      void input;
      return Promise.resolve({ id: "imgop_test" });
    });
    let role: "owner" | "admin" = "admin";
    let scopes = new Set(["admin:update:write", "admin:tex-environment:write"]);
    const authenticate = vi.fn((_token: string, requiredScope?: string) => {
      if (requiredScope !== undefined && !scopes.has(requiredScope)) {
        throw new AppError(
          "INSUFFICIENT_SCOPE",
          "API key lacks the required scope",
          403,
        );
      }
      return {
        apiKeyId: "key_admin",
        serviceAccountId: "sa_admin",
        userId: "user_owner",
        userSecurityVersion: 1,
        serviceAccountSecurityVersion: 1,
        scopes: [...scopes],
        keyKind: "admin" as const,
      };
    });
    const app = createAdminApp({
      database: {
        users: {
          get: () => ({ id: "user_owner", status: "active", role }),
        },
        audit: (entry: Record<string, unknown>) => audits.push(entry),
      } as never,
      apiKeys: { authenticate } as never,
      browserAuth: {} as never,
      deploymentMode: "standalone",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(["https://latex.example.com"]),
      writeEnabled: true,
      storageRoot: "/tmp",
      rendererVersion: "test",
      maxOutputBytes: 1,
      maxQueueLength: 1,
      maxUserStorageBytes: 1,
      minFreeStorageBytes: 1,
      activeTicketKid: "v2",
      verificationTicketKids: ["v1"],
      updateManager: {
        apply: updateApply,
        state: vi.fn(() => Promise.resolve({})),
      } as never,
      imageManager: { apply: imageApply } as never,
    });
    const post = (path: string, body: unknown) =>
      app.request(`/admin/api/v1${path}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

    expect((await post("/updates/apply", { reason: "planned" })).status).toBe(
      403,
    );
    expect(updateApply).not.toHaveBeenCalled();

    role = "owner";
    expect((await post("/updates/apply", {})).status).toBe(400);
    expect(updateApply).not.toHaveBeenCalled();
    expect(
      (
        await post("/updates/apply", {
          version: "v1.2.3",
          reason: "  planned maintenance  ",
        })
      ).status,
    ).toBe(202);
    expect(updateApply).toHaveBeenCalledWith("v1.2.3");
    expect(authenticate).toHaveBeenCalledWith(
      "test-token",
      "admin:update:write",
    );
    expect(audits.at(-1)).toMatchObject({
      action: "application_update.apply_requested",
      metadata: { reason: "planned maintenance" },
    });

    expect(
      (
        await post("/tex-environment/apply", {
          selector: { mode: "latest" },
          languages: [],
          autoUpdate: false,
          reason: "  refresh runtime  ",
        })
      ).status,
    ).toBe(202);
    expect(imageApply).toHaveBeenCalledWith({
      selector: { mode: "latest" },
      languages: [],
      autoUpdate: false,
      rebuildIfMissing: true,
      runtimeBuildIfMissing: false,
    });
    expect(authenticate).toHaveBeenCalledWith(
      "test-token",
      "admin:tex-environment:write",
    );
    expect(audits.at(-1)).toMatchObject({
      action: "tex_environment.apply_requested",
      metadata: { reason: "refresh runtime" },
    });

    scopes = new Set(["admin:system:read"]);
    const response = await app.request("/admin/api/v1/updates/state", {
      headers: { Authorization: "Bearer test-token" },
    });
    expect(response.status).toBe(403);
  });
});

function openApiPathBlock(document: string, path: string): string {
  const marker = `\n  ${path}:`;
  const start = document.indexOf(marker);
  if (start < 0) return "";
  const nextPath = document.indexOf("\n  /", start + marker.length);
  return document.slice(start, nextPath < 0 ? document.length : nextPath);
}
