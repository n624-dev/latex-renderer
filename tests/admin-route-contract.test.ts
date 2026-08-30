import { describe, expect, it } from "vitest";
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
});
