#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { ApiKeyService } from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import { AppError, newId, nowIso } from "@latex-renderer/shared";

const allowedGid =
  process.env.LATEX_RENDERER_ADMIN_GID === undefined
    ? undefined
    : Number(process.env.LATEX_RENDERER_ADMIN_GID);
const processGroups = process.getgroups?.() ?? [];
if (
  process.geteuid?.() !== 0 &&
  (allowedGid === undefined || !processGroups.includes(allowedGid))
)
  throw new Error("Must run as root or a configured recovery group member");
const database = new RendererDatabase(required("DATABASE_PATH"));
database.migrate();
const pepperId = process.env.API_KEY_PEPPER_ID ?? "v1";
const keys = new ApiKeyService(
  database,
  new Map([[pepperId, readFileSync(required("API_KEY_PEPPER_FILE"))]]),
  pepperId,
);
const program = new Command().name("latex-renderer-admin-local");
program
  .command("bootstrap")
  .requiredOption("--email <email>")
  .requiredOption("--display-name <name>")
  .requiredOption("--access-subject <subject>")
  .action(
    (o: { email: string; displayName: string; accessSubject: string }) => {
      database.transaction(() => {
        const count = database.raw
          .prepare("SELECT COUNT(*) AS count FROM users WHERE role='owner'")
          .get() as { count: number };
        if (count.count !== 0)
          throw new AppError("OWNER_EXISTS", "An owner already exists", 409);
        const id = newId("user"),
          now = nowIso();
        database.raw
          .prepare(
            `INSERT INTO users(id,access_subject,email,display_name,role,status,security_version,created_by,created_at,updated_at) VALUES (?,?,?,?, 'owner','active',1,'local-bootstrap',?,?)`,
          )
          .run(id, o.accessSubject, o.email, o.displayName, now, now);
        database.audit({
          actorType: "local",
          actorId: String(process.geteuid?.() ?? -1),
          action: "user.created",
          targetType: "user",
          targetId: id,
          result: "success",
          metadata: { role: "owner" },
        });
        process.stdout.write(`${id}\n`);
      });
    },
  );
program
  .command("revoke-all")
  .requiredOption("--yes")
  .action(() => {
    const changes = database.transaction(() => {
      const now = nowIso();
      const result = database.raw
        .prepare("UPDATE api_keys SET revoked_at=? WHERE revoked_at IS NULL")
        .run(now);
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "api_key.revoked_all",
        targetType: "system",
        targetId: "all",
        result: "success",
        metadata: { count: Number(result.changes) },
      });
      return result.changes;
    });
    process.stdout.write(`${String(changes)} keys revoked\n`);
  });
program
  .command("enable-user")
  .argument("<id>")
  .requiredOption("--yes")
  .action((id: string) => {
    database.transaction(() => {
      const now = nowIso();
      const result = database.raw
        .prepare(
          "UPDATE users SET status='active', security_version=security_version+1, updated_at=? WHERE id=? AND status!='active'",
        )
        .run(now, id);
      if (result.changes !== 1)
        throw new AppError(
          "USER_NOT_FOUND_OR_ACTIVE",
          "User was not found or is already active",
          404,
        );
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "user.enabled",
        targetType: "user",
        targetId: id,
        result: "success",
      });
    });
    process.stdout.write(`${id} enabled\n`);
  });
program
  .command("create-break-glass")
  .requiredOption("--service-account <id>")
  .requiredOption("--yes")
  .action((o: { serviceAccount: string }) => {
    const generated = keys.create("admin");
    database.transaction(() => {
      database.raw
        .prepare(
          `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,'local-recovery')`,
        )
        .run(
          generated.id,
          o.serviceAccount,
          "break-glass",
          generated.prefix,
          generated.secretHash,
          generated.pepperId,
          JSON.stringify(["admin:*"]),
          nowIso(),
        );
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "api_key.created",
        targetType: "api_key",
        targetId: generated.id,
        result: "success",
        metadata: { breakGlass: true },
      });
    });
    process.stdout.write(`${generated.token}\n`);
  });
const localUsers = program.command("users");
localUsers.command("list").action(() => {
  process.stdout.write(
    `${JSON.stringify({ items: database.raw.prepare("SELECT id,email,display_name,role,status,security_version FROM users ORDER BY created_at").all() }, null, 2)}\n`,
  );
});
localUsers
  .command("enable")
  .requiredOption("--email <email>")
  .requiredOption("--yes")
  .action((o: { email: string }) => {
    const id = database.transaction(() => {
      const now = nowIso();
      const row = database.raw
        .prepare("SELECT id FROM users WHERE email=? COLLATE NOCASE")
        .get(o.email) as { id: string } | undefined;
      if (row === undefined)
        throw new AppError("USER_NOT_FOUND", "User does not exist", 404);
      const result = database.raw
        .prepare(
          "UPDATE users SET status='active',security_version=security_version+1,updated_at=? WHERE id=? AND status!='active'",
        )
        .run(now, row.id);
      if (result.changes !== 1)
        throw new AppError(
          "USER_ALREADY_ACTIVE",
          "User is already active",
          409,
        );
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "user.enabled",
        targetType: "user",
        targetId: row.id,
        result: "success",
      });
      return row.id;
    });
    process.stdout.write(`${id} enabled\n`);
  });
const localKeys = program.command("api-keys");
localKeys
  .command("revoke-all")
  .requiredOption("--yes")
  .action(() => {
    const changes = database.transaction(() => {
      const timestamp = nowIso();
      const result = database.raw
        .prepare("UPDATE api_keys SET revoked_at=? WHERE revoked_at IS NULL")
        .run(timestamp);
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "api_key.revoked_all",
        targetType: "system",
        targetId: "all",
        result: "success",
        metadata: { count: Number(result.changes) },
      });
      return result.changes;
    });
    process.stdout.write(`${String(changes)} keys revoked\n`);
  });
localKeys
  .command("create-break-glass")
  .requiredOption("--service-account <id>")
  .requiredOption("--yes")
  .action((o: { serviceAccount: string }) => {
    const generated = keys.create("admin");
    database.transaction(() => {
      database.raw
        .prepare(
          `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,'local-recovery')`,
        )
        .run(
          generated.id,
          o.serviceAccount,
          "break-glass",
          generated.prefix,
          generated.secretHash,
          generated.pepperId,
          JSON.stringify(["admin:*"]),
          nowIso(),
        );
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "api_key.created",
        targetType: "api_key",
        targetId: generated.id,
        result: "success",
        metadata: { breakGlass: true },
      });
    });
    process.stdout.write(`${generated.token}\n`);
  });
const localTickets = program.command("tickets");
localTickets
  .command("revoke-kid")
  .argument("<kid>")
  .requiredOption("--reason <reason>")
  .requiredOption("--expires-at <date>")
  .requiredOption("--yes")
  .action((kid: string, o: { reason: string; expiresAt: string }) => {
    if (
      !/^[A-Za-z0-9._-]{1,100}$/.test(kid) ||
      !Number.isFinite(Date.parse(o.expiresAt)) ||
      o.expiresAt <= nowIso()
    )
      throw new AppError(
        "INVALID_REVOCATION",
        "Key id or expiry is invalid",
        400,
      );
    database.transaction(() => {
      database.raw
        .prepare(
          `INSERT INTO revoked_tickets(selector_type,selector_value,reason,expires_at,created_at) VALUES ('kid',?,?,?,?) ON CONFLICT(selector_type,selector_value) DO UPDATE SET reason=excluded.reason,expires_at=excluded.expires_at,created_at=excluded.created_at`,
        )
        .run(kid, o.reason, o.expiresAt, nowIso());
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "ticket_key.revoked",
        targetType: "ticket_key",
        targetId: kid,
        result: "success",
        metadata: { expiresAt: o.expiresAt },
      });
    });
    process.stdout.write(`${kid} revoked\n`);
  });
const webPrincipals = program.command("web-principals");
webPrincipals
  .command("ensure")
  .requiredOption("--yes")
  .action(() => {
    const created = database.transaction(() =>
      database.webPrincipals.ensureAll(),
    );
    process.stdout.write(
      `${JSON.stringify({ created, total: database.raw.prepare("SELECT COUNT(*) AS count FROM web_principals").get() })}\n`,
    );
  });
const smokeKey = program.command("smoke-key");
smokeKey
  .command("create")
  .requiredOption("--owner-email <email>")
  .requiredOption("--yes")
  .action((o: { ownerEmail: string }) => {
    const owner = database.raw
      .prepare(
        "SELECT id FROM users WHERE email=? COLLATE NOCASE AND role='owner' AND status='active'",
      )
      .get(o.ownerEmail) as { id: string } | undefined;
    if (owner === undefined)
      throw new AppError(
        "ACTIVE_OWNER_NOT_FOUND",
        "An active owner with that email was not found",
        404,
      );
    const serviceAccountId = newId("sa"),
      generated = keys.create("render"),
      timestamp = nowIso(),
      expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    database.transaction(() => {
      database.raw
        .prepare(
          `INSERT INTO service_accounts(id,owner_user_id,name,client_type,status,security_version,created_at,updated_at)
    VALUES (?,?,?,'ci','active',1,?,?)`,
        )
        .run(
          serviceAccountId,
          owner.id,
          `production-smoke-${serviceAccountId}`,
          timestamp,
          timestamp,
        );
      database.raw
        .prepare(
          `INSERT INTO api_keys(id,service_account_id,name,prefix,secret_hash,pepper_id,scopes_json,expires_at,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,'local-smoke-test')`,
        )
        .run(
          generated.id,
          serviceAccountId,
          "production-smoke",
          generated.prefix,
          generated.secretHash,
          generated.pepperId,
          JSON.stringify(["render:create", "render:read:own"]),
          expiresAt,
          timestamp,
        );
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "api_key.created",
        targetType: "api_key",
        targetId: generated.id,
        result: "success",
        metadata: { smokeTest: true, expiresAt },
      });
    });
    process.stdout.write(
      `${JSON.stringify({ token: generated.token, keyId: generated.id, serviceAccountId, expiresAt })}\n`,
    );
  });
smokeKey
  .command("revoke")
  .requiredOption("--key-id <id>")
  .requiredOption("--service-account <id>")
  .requiredOption("--yes")
  .action((o: { keyId: string; serviceAccount: string }) => {
    database.transaction(() => {
      const timestamp = nowIso();
      const row = database.raw
        .prepare(
          `SELECT k.id FROM api_keys k JOIN service_accounts s ON s.id=k.service_account_id
      WHERE k.id=? AND s.id=? AND s.name LIKE 'production-smoke-%'`,
        )
        .get(o.keyId, o.serviceAccount);
      if (row === undefined)
        throw new AppError(
          "SMOKE_KEY_NOT_FOUND",
          "Smoke-test key was not found",
          404,
        );
      database.raw
        .prepare(
          "UPDATE api_keys SET revoked_at=COALESCE(revoked_at,?) WHERE id=?",
        )
        .run(timestamp, o.keyId);
      database.raw
        .prepare(
          "UPDATE service_accounts SET status='disabled',security_version=security_version+1,updated_at=? WHERE id=? AND status='active'",
        )
        .run(timestamp, o.serviceAccount);
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "api_key.revoked",
        targetType: "api_key",
        targetId: o.keyId,
        result: "success",
        metadata: { smokeTest: true },
      });
    });
    process.stdout.write("Smoke-test credential revoked.\n");
  });
smokeKey
  .command("cleanup-jobs")
  .requiredOption("--yes")
  .action(() => {
    const count = database.transaction(() => {
      const timestamp = nowIso();
      const result = database.raw
        .prepare(
          `UPDATE jobs SET status='deleting',updated_at=?
      WHERE service_account_id IN (SELECT id FROM service_accounts WHERE name LIKE 'production-smoke-%')
      AND status IN ('succeeded','failed','timeout','canceled','rejected','expired')`,
        )
        .run(timestamp);
      database.audit({
        actorType: "local",
        actorId: String(process.geteuid?.() ?? -1),
        action: "render.bulk_deleted",
        targetType: "system",
        targetId: "production-smoke",
        result: "requested",
        metadata: { count: Number(result.changes) },
      });
      return result.changes;
    });
    process.stdout.write(
      `${String(count)} smoke-test jobs queued for deletion.\n`,
    );
  });
await program.parseAsync().finally(() => database.close());
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
