import { describe, expect, it } from "vitest";
import { createAdminApp } from "../apps/admin-api/src/app.js";

describe("admin route contract", () => {
  it("serves canonical and compatibility prefixes", async () => {
    const app = createAdminApp({
      database: { users: { findByAccessSubject: () => undefined } } as never,
      apiKeys: {} as never,
      access: {
        verify: () => Promise.resolve({ subject: "missing", payload: {} }),
      } as never,
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
});
