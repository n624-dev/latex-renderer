import { EventEmitter } from "node:events";
import { RendererDatabase } from "@latex-renderer/database";
import { AppError } from "@latex-renderer/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAdminApp } from "../apps/admin-api/src/app.js";

const { connect } = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("node:net", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:net")>()),
  createConnection: connect,
}));

const route = "/admin/api/v1/backups/retention";
const policyKey = "backup_retention_policy";
const limits = { maxAgeDays: 7, maxGenerations: 2, maxTotalBytes: 0 };
const archive = {
  name: "latex-renderer-2026-11-28T00-00-00.000Z.tar.age",
  bytes: 10,
};
const status = {
  archives: [archive],
  policy: null,
  schedule: "daily",
  freeBytes: 44,
  candidates: { maxAgeDays: 1, maxGenerations: 1, maxTotalBytes: 11 },
  lastRun: null,
  latestVerification: null,
  plan: { configured: false, delete: [], warnings: [] },
  proposedPlan: { delete: [], warnings: ["PROTECTED_OVER_BYTES"] },
};
const prune = {
  status: "succeeded",
  deleted: [],
  warnings: ["PROTECTED_OVER_BYTES"],
};

class FakeSocket extends EventEmitter {
  setEncoding = vi.fn();
  setTimeout = vi.fn();
  destroy = vi.fn();

  constructor(private readonly respond: (line: string) => object | Error) {
    super();
  }

  write(line: string) {
    const result = this.respond(line);
    if (result instanceof Error) this.emit("error", result);
    else this.emit("data", JSON.stringify(result) + "\n");
  }
}

describe("admin backup retention routes", () => {
  let database: RendererDatabase;
  let app: ReturnType<typeof createAdminApp>;
  let role: "owner" | "admin";
  let scopes: Set<string>;
  let respond: ReturnType<typeof vi.fn<(line: string) => object | Error>>;
  const statusRequest = 'retention {"minFreeStorageBytes":10}\n';
  const authenticate = vi.fn((_token: string, scope: string) => {
    if (!scopes.has(scope))
      throw new AppError("INSUFFICIENT_SCOPE", "Missing scope", 403);
    return { keyKind: "admin", apiKeyId: "key_owner", userId: "user_owner" };
  });
  const csrf = vi.fn((request: Request) => {
    if (request.headers.get("X-CSRF-Token") !== "fixture")
      throw new AppError("CSRF_REQUIRED", "CSRF token required", 403);
  });

  beforeEach(() => {
    role = "owner";
    scopes = new Set(["admin:system:read", "admin:system:write"]);
    authenticate.mockClear();
    csrf.mockClear();
    database = new RendererDatabase(":memory:");
    database.migrate();
    vi.spyOn(database.users, "get").mockImplementation(
      () => ({ role, status: "active" }) as never,
    );
    respond = vi.fn((line) => (line === "prune\n" ? prune : status));
    connect.mockReset().mockImplementation(() => {
      const socket = new FakeSocket(respond);
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });
    app = createAdminApp({
      database,
      apiKeys: { authenticate } as never,
      browserAuth: {
        authenticate: () =>
          Promise.resolve({
            user: { id: "user_owner", role, status: "active" },
            authMode: "password",
          }),
        requireMutationCsrf: csrf,
      } as never,
      deploymentMode: "standalone",
      publicOrigin: "https://latex.example.com",
      allowedOrigins: new Set(["https://latex.example.com"]),
      writeEnabled: true,
      storageRoot: process.cwd(),
      rendererVersion: "test",
      maxOutputBytes: 1,
      maxQueueLength: 1,
      maxUserStorageBytes: 1,
      minFreeStorageBytes: 10,
      activeTicketKid: "v2",
      verificationTicketKids: [],
    });
  });

  afterEach(() => database.close());

  const get = (query = "") =>
    app.request(route + query, {
      headers: { Authorization: "Bearer fixture" },
    });

  const post = (
    body: unknown,
    headers: Record<string, string> = { Authorization: "Bearer fixture" },
  ) =>
    app.request(route, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("requires an owner, distinct read and write scopes, and browser mutation CSRF", async () => {
    role = "admin";
    expect((await get()).status).toBe(403);
    expect((await post({ ...limits, reason: "test" })).status).toBe(403);
    role = "owner";
    scopes.delete("admin:system:read");
    expect((await get()).status).toBe(403);
    scopes.add("admin:system:read");
    scopes.delete("admin:system:write");
    expect((await post({ ...limits, reason: "test" })).status).toBe(403);
    expect(
      (
        await post(
          { ...limits, reason: "test" },
          {
            Origin: "https://latex.example.com",
          },
        )
      ).status,
    ).toBe(403);
    expect(csrf).toHaveBeenCalledTimes(1);
    expect(connect).not.toHaveBeenCalled();
  });

  it("forwards the configured reserve and the proposed policy and returns the socket plan", async () => {
    await expect((await get()).json()).resolves.toEqual(status);
    expect(respond).toHaveBeenLastCalledWith(statusRequest);
    const preview = await get("?maxAgeDays=7&maxGenerations=2&maxTotalBytes=0");
    expect(preview.status).toBe(200);
    await expect(preview.json()).resolves.toEqual(status);
    expect(respond).toHaveBeenLastCalledWith(
      `retention ${JSON.stringify({ minFreeStorageBytes: 10, proposedPolicy: limits })}\n`,
    );
    expect(authenticate).toHaveBeenCalledWith("fixture", "admin:system:read");
    expect(database.settings.get(policyKey)).toBeUndefined();
  });

  it("rejects missing, repeated, unknown, and out-of-range query limits", async () => {
    for (const query of [
      "?maxAgeDays=7",
      "?maxAgeDays=7&maxGenerations=2&maxTotalBytes=0&maxAgeDays=7",
      "?maxAgeDays=7&maxGenerations=2&maxTotalBytes=0&unknown=x",
      "?maxAgeDays=7&maxGenerations=0&maxTotalBytes=1",
      "?maxAgeDays=7&maxGenerations=2&maxTotalBytes=9007199254740992",
      "?maxAgeDays=7&maxGenerations=2&maxTotalBytes=1e4",
    ])
      expect((await get(query)).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
  });

  it("rejects malformed policies and reasons before touching the socket or settings", async () => {
    for (const invalid of [
      limits,
      { ...limits, reason: " " },
      { ...limits, reason: "x".repeat(501) },
      { ...limits, maxAgeDays: 0, reason: "test" },
      { ...limits, maxGenerations: "2", reason: "test" },
      { ...limits, maxTotalBytes: -1, reason: "test" },
      { ...limits, reason: "test", confirmedBy: "untrusted" },
    ])
      expect((await post(invalid)).status).toBe(400);
    expect(connect).not.toHaveBeenCalled();
    expect(database.settings.get(policyKey)).toBeUndefined();
  });

  it("requires an archive before first confirmation", async () => {
    respond.mockReturnValueOnce({ ...status, archives: [], candidates: null });
    expect((await post({ ...limits, reason: "test" })).status).toBe(409);
    expect(database.settings.get(policyKey)).toBeUndefined();
    expect(respond.mock.calls).toEqual([[statusRequest]]);
  });

  it("saves and audits the confirmation before invoking prune", async () => {
    respond.mockReturnValueOnce(status).mockImplementationOnce(() => {
      expect(database.settings.get(policyKey)?.updated_by).toBe("key_owner");
      expect(
        database.raw
          .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = ?")
          .get("backup.retention.confirmed"),
      ).toMatchObject({ n: 1 });
      return prune;
    });
    const response = await post({ ...limits, reason: "  Storage budget  " });
    expect(response.status).toBe(200);
    const confirmed = {
      ...limits,
      confirmedBy: "key_owner",
      confirmedAt: expect.any(String) as unknown,
    };
    await expect(response.json()).resolves.toEqual({
      policy: confirmed,
      prune,
    });
    expect(database.settings.value<unknown>(policyKey, null)).toEqual(
      confirmed,
    );
    const audit = database.raw
      .prepare("SELECT * FROM audit_logs WHERE action = ?")
      .get("backup.retention.confirmed") as {
      metadata_json: string;
      actor_id: string;
    };
    expect(audit.actor_id).toBe("key_owner");
    expect(JSON.parse(audit.metadata_json)).toEqual({
      ...confirmed,
      reason: "Storage budget",
    });
    expect(respond.mock.calls).toEqual([[statusRequest], ["prune\n"]]);
    expect(authenticate).toHaveBeenCalledWith("fixture", "admin:system:write");
  });

  it.each([
    {
      result: new Error("socket unavailable"),
      warnings: ["BACKUP_CONTROL_UNAVAILABLE"],
    },
    {
      result: {
        status: "failed",
        deleted: [archive.name],
        warnings: ["PRUNE_FAILED"],
      },
      warnings: ["PRUNE_FAILED"],
    },
  ])(
    "preserves the policy and reports prune failure $warnings",
    async ({ result, warnings }) => {
      respond.mockReturnValueOnce(status).mockReturnValueOnce(result);
      const response = await post({ ...limits, reason: "test" });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        prune: { status: "failed", warnings },
      });
      expect(database.settings.value<unknown>(policyKey, null)).toMatchObject(
        limits,
      );
    },
  );
});
