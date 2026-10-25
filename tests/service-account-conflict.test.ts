import { afterEach, expect, it, vi } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import { ServiceAccountsService } from "../apps/admin-api/src/services/service-accounts.js";

const databases: RendererDatabase[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});
function fixture() {
  const database = new RendererDatabase(":memory:");
  databases.push(database);
  database.migrate();
  for (const id of ["owner", "other"])
    database.users.insertInvitation({
      id,
      displayName: id,
      role: "owner",
      createdBy: "fixture",
      timestamp: new Date().toISOString(),
    });
  const service = new ServiceAccountsService({
    database,
  } as ConstructorParameters<typeof ServiceAccountsService>[0]);
  const actor = {
    type: "user",
    id: "owner",
    userId: "owner",
    role: "owner",
  } as const;
  const create = (name: string, ownerUserId = "owner") =>
    service.create(actor, { ownerUserId, name, clientType: "generic" });
  return { database, service, actor, create };
}
it("returns 409 for duplicate create/rename without changing rows or success audits", () => {
  const f = fixture(),
    first = f.create("first"),
    second = f.create("second");
  const before = f.database.raw
    .prepare("SELECT * FROM service_accounts ORDER BY id")
    .all();
  const audits = f.database.raw
    .prepare("SELECT * FROM audit_logs ORDER BY id")
    .all();
  for (const operation of [
    () => f.create("first"),
    () =>
      f.service.update(f.actor, second, { name: "first", clientType: "mcp" }),
  ])
    expect(operation).toThrow(
      expect.objectContaining({
        code: "SERVICE_ACCOUNT_NAME_CONFLICT",
        status: 409,
      }),
    );
  expect(
    f.database.raw.prepare("SELECT * FROM service_accounts ORDER BY id").all(),
  ).toEqual(before);
  expect(
    f.database.raw.prepare("SELECT * FROM audit_logs ORDER BY id").all(),
  ).toEqual(audits);
  expect(f.database.serviceAccounts.get(first)?.name).toBe("first");
});
it("permits the same name for another owner and idempotent self-renames", () => {
  const f = fixture(),
    id = f.create("same");
  expect(() => f.create("same", "other")).not.toThrow();
  expect(() => f.service.update(f.actor, id, { name: "same" })).not.toThrow();
  f.service.changeStatus(f.actor, id, "disable");
  expect(() => f.create("same")).toThrow(
    expect.objectContaining({ status: 409 }),
  );
  expect(() => f.service.update(f.actor, "missing", { name: "same" })).toThrow(
    expect.objectContaining({ status: 404 }),
  );
});
it("does not relabel unexpected database failures as name conflicts", () => {
  const f = fixture(),
    id = f.create("old"),
    failure = new Error("fixture disk error");
  vi.spyOn(f.database.serviceAccounts, "insert").mockImplementation(() => {
    throw failure;
  });
  expect(() => f.create("new")).toThrow(failure);
  vi.spyOn(f.database.serviceAccounts, "update").mockImplementation(() => {
    throw failure;
  });
  expect(() => f.service.update(f.actor, id, { name: "new" })).toThrow(failure);
  expect(f.database.serviceAccounts.get(id)?.name).toBe("old");
});
