#!/usr/bin/env node
import { lstatSync, readFileSync } from "node:fs";
import { Command } from "commander";
import {
  ApiKeyService,
  BrowserAuthenticationService,
  normalizeLoginName,
  parseAuthMode,
} from "@latex-renderer/auth";
import { RendererDatabase } from "@latex-renderer/database";
import {
  AppError,
  boundedIntegerEnvironment,
  newId,
  nowIso,
} from "@latex-renderer/shared";

const allowedGid =
  process.env.LATEX_RENDERER_ADMIN_GID === undefined
    ? undefined
    : boundedIntegerEnvironment(
        process.env,
        "LATEX_RENDERER_ADMIN_GID",
        0,
        0,
        4_294_967_295,
      );
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
  .requiredOption("--auth-mode <mode>")
  .requiredOption("--display-name <name>")
  .option("--email <email>")
  .option("--subject <subject>")
  .option("--issuer <issuer>")
  .option("--login-name <name>")
  .option("--password-file <path>")
  .action(
    async (o: {
      authMode: string;
      email?: string | undefined;
      displayName: string;
      subject?: string | undefined;
      issuer?: string | undefined;
      loginName?: string | undefined;
      passwordFile?: string | undefined;
    }) => {
      const authMode = parseAuthMode(o.authMode);
      const displayName = boundedText(o.displayName, "display name", 200);
      const email =
        o.email === undefined ? undefined : normalizedEmail(o.email);
      let passwordHash: string | undefined;
      let loginName: string | undefined;
      if (authMode === "password") {
        if (o.loginName === undefined || o.passwordFile === undefined)
          throw new AppError(
            "BOOTSTRAP_OPTIONS_INVALID",
            "Password bootstrap requires --login-name and --password-file",
            400,
          );
        loginName = normalizeLoginName(o.loginName);
        const password = readBootstrapPassword(o.passwordFile);
        const passwordAuth = new BrowserAuthenticationService({
          database,
          mode: "password",
          publicOrigin: "https://bootstrap.invalid",
          passwordPepper: readFileSync(required("AUTH_PASSWORD_PEPPER_FILE")),
        });
        passwordHash = await passwordAuth.hashPassword(password, loginName);
      } else if (o.subject === undefined || o.issuer === undefined) {
        throw new AppError(
          "BOOTSTRAP_OPTIONS_INVALID",
          "External bootstrap requires --subject and --issuer",
          400,
        );
      } else boundedText(o.subject, "external identity subject", 500);
      database.transaction(() => {
        const count = database.raw
          .prepare("SELECT COUNT(*) AS count FROM users WHERE role='owner'")
          .get() as { count: number };
        if (count.count !== 0)
          throw new AppError("OWNER_EXISTS", "An owner already exists", 409);
        const id = newId("user"),
          now = nowIso();
        database.users.insertInvitation({
          id,
          email: email ?? null,
          displayName,
          role: "owner",
          createdBy: "local-bootstrap",
          timestamp: now,
        });
        if (authMode === "password") {
          database.browserAuth.upsertCredential({
            user_id: id,
            login_name: loginName ?? "",
            password_hash: passwordHash ?? "",
            password_updated_at: now,
          });
        } else {
          database.browserAuth.insertIdentity({
            id: newId("identity"),
            user_id: id,
            provider: authMode,
            issuer: strictIssuer(o.issuer ?? "", authMode),
            subject: boundedText(
              o.subject ?? "",
              "external identity subject",
              500,
            ),
            preferred_username: null,
            email_at_provider: email ?? null,
            linked_at: now,
            last_seen_at: now,
          });
        }
        database.webPrincipals.ensure(id);
        database.audit({
          actorType: "local",
          actorId: String(process.geteuid?.() ?? -1),
          action: "user.created",
          targetType: "user",
          targetId: id,
          result: "success",
          metadata: { role: "owner", authMode },
        });
        process.stdout.write(`${id}\n`);
      });
    },
  );
const localAuth = program.command("auth");
localAuth
  .command("provision-owner")
  .description(
    "Provision a new browser-auth method for an existing active owner before an AUTH_MODE switch",
  )
  .requiredOption("--owner-id <id>")
  .requiredOption("--auth-mode <mode>")
  .option("--subject <subject>")
  .option("--issuer <issuer>")
  .option("--login-name <name>")
  .option("--password-file <path>")
  .requiredOption("--yes")
  .action(
    async (o: {
      ownerId: string;
      authMode: string;
      subject?: string | undefined;
      issuer?: string | undefined;
      loginName?: string | undefined;
      passwordFile?: string | undefined;
    }) => {
      if (!/^user_[a-f0-9]{32}$/.test(o.ownerId))
        throw new AppError("OWNER_ID_INVALID", "Owner id is invalid", 400);
      const authMode = parseAuthMode(o.authMode);
      let loginName: string | undefined;
      let passwordHash: string | undefined;
      let issuer: string | undefined;
      let subject: string | undefined;
      if (authMode === "password") {
        if (o.loginName === undefined || o.passwordFile === undefined)
          throw new AppError(
            "PROVISION_OPTIONS_INVALID",
            "Password provisioning requires --login-name and --password-file",
            400,
          );
        loginName = normalizeLoginName(o.loginName);
        const passwordAuth = new BrowserAuthenticationService({
          database,
          mode: "password",
          publicOrigin: "https://provision.invalid",
          passwordPepper: readFileSync(required("AUTH_PASSWORD_PEPPER_FILE")),
        });
        passwordHash = await passwordAuth.hashPassword(
          readBootstrapPassword(o.passwordFile),
          loginName,
        );
      } else {
        if (o.subject === undefined || o.issuer === undefined)
          throw new AppError(
            "PROVISION_OPTIONS_INVALID",
            "External provisioning requires --subject and --issuer",
            400,
          );
        issuer = strictIssuer(o.issuer, authMode);
        subject = boundedText(o.subject, "external identity subject", 500);
      }

      database.transaction(() => {
        const owner = database.raw
          .prepare(
            "SELECT id FROM users WHERE id=? AND role='owner' AND status='active'",
          )
          .get(o.ownerId) as { id: string } | undefined;
        if (owner === undefined)
          throw new AppError(
            "ACTIVE_OWNER_NOT_FOUND",
            "An active owner with that id was not found",
            404,
          );
        const timestamp = nowIso();
        if (authMode === "password") {
          if (
            database.browserAuth.getCredentialForUser(owner.id) !== undefined ||
            database.browserAuth.getCredentialByLogin(loginName ?? "") !==
              undefined
          )
            throw new AppError(
              "CREDENTIAL_ALREADY_EXISTS",
              "The owner or login name already has a password credential",
              409,
            );
          database.raw
            .prepare(
              `INSERT INTO local_credentials(user_id,login_name,password_hash,password_updated_at)
               VALUES (?,?,?,?)`,
            )
            .run(owner.id, loginName ?? "", passwordHash ?? "", timestamp);
        } else {
          if (
            database.browserAuth.findIdentity(
              authMode,
              issuer ?? "",
              subject ?? "",
            ) !== undefined ||
            database.browserAuth
              .identitiesForUser(owner.id)
              .some(
                (identity) =>
                  identity.provider === authMode && identity.issuer === issuer,
              )
          )
            throw new AppError(
              "IDENTITY_ALREADY_EXISTS",
              "The external identity or provider/issuer link already exists",
              409,
            );
          database.browserAuth.insertIdentity({
            id: newId("identity"),
            user_id: owner.id,
            provider: authMode,
            issuer: issuer ?? "",
            subject: subject ?? "",
            preferred_username: null,
            email_at_provider: null,
            linked_at: timestamp,
            last_seen_at: timestamp,
          });
        }
        database.raw
          .prepare(
            "UPDATE users SET security_version=security_version+1,updated_at=? WHERE id=?",
          )
          .run(timestamp, owner.id);
        database.browserAuth.revokeUserSessions(owner.id, timestamp);
        database.audit({
          actorType: "local",
          actorId: String(process.geteuid?.() ?? -1),
          action: "user.auth_provisioned",
          targetType: "user",
          targetId: owner.id,
          result: "success",
          metadata: { authMode },
        });
      });
      process.stdout.write(
        `${authMode} authentication provisioned for ${o.ownerId}; existing browser sessions were revoked.\n`,
      );
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
          `INSERT INTO api_keys(id,service_account_id,name,prefix,kind,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,'local-recovery')`,
        )
        .run(
          generated.id,
          o.serviceAccount,
          "break-glass",
          generated.prefix,
          generated.kind,
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
          `INSERT INTO api_keys(id,service_account_id,name,prefix,kind,secret_hash,pepper_id,scopes_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,'local-recovery')`,
        )
        .run(
          generated.id,
          o.serviceAccount,
          "break-glass",
          generated.prefix,
          generated.kind,
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
  .requiredOption("--owner-id <id>")
  .requiredOption("--yes")
  .action((o: { ownerId: string }) => {
    if (!/^user_[a-f0-9]{32}$/.test(o.ownerId))
      throw new AppError("OWNER_ID_INVALID", "Owner id is invalid", 400);
    const owner = database.raw
      .prepare(
        "SELECT id FROM users WHERE id=? AND role='owner' AND status='active'",
      )
      .get(o.ownerId) as { id: string } | undefined;
    if (owner === undefined)
      throw new AppError(
        "ACTIVE_OWNER_NOT_FOUND",
        "An active owner with that id was not found",
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
          `INSERT INTO api_keys(id,service_account_id,name,prefix,kind,secret_hash,pepper_id,scopes_json,expires_at,created_at,created_by)
      VALUES (?,?,?,?,?,?,?,?,?,'local-smoke-test')`,
        )
        .run(
          generated.id,
          serviceAccountId,
          "production-smoke",
          generated.prefix,
          generated.kind,
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
          `UPDATE jobs SET render_status=status,status='deleting',deletion_status='pending',
      deletion_attempts=0,deletion_error=NULL,deletion_next_attempt_at=NULL,updated_at=?
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

function boundedText(value: string, label: string, maximum: number): string {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > maximum ||
    hasControlCharacters(value)
  )
    throw new AppError("BOOTSTRAP_VALUE_INVALID", `${label} is invalid`, 400);
  return value;
}

function normalizedEmail(value: string): string {
  const email = boundedText(value, "email", 320);
  if (!/^[^\s@]+@[^\s@]+$/.test(email))
    throw new AppError("BOOTSTRAP_VALUE_INVALID", "email is invalid", 400);
  return email;
}

function readBootstrapPassword(path: string): string {
  const stat = lstatSync(path);
  const allowedOwners = new Set([
    process.geteuid?.(),
    process.env.SUDO_UID === undefined
      ? undefined
      : boundedIntegerEnvironment(
          process.env,
          "SUDO_UID",
          0,
          0,
          4_294_967_295,
        ),
  ]);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.size < 12 ||
    stat.size > 4097 ||
    !allowedOwners.has(stat.uid) ||
    (stat.mode & 0o077) !== 0
  )
    throw new AppError(
      "PASSWORD_FILE_INVALID",
      "Password file must be a private regular file owned by the invoking account",
      400,
    );
  const password = readFileSync(path, "utf8").replace(/\r?\n$/, "");
  if (password.includes("\r") || password.includes("\n"))
    throw new AppError(
      "PASSWORD_FILE_INVALID",
      "Password file must contain exactly one line",
      400,
    );
  return password;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

function strictIssuer(
  value: string,
  mode: "cloudflare-access" | "oidc",
): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new AppError("ISSUER_INVALID", "Issuer must be an HTTPS URL", 400);
  if (mode === "cloudflare-access" && url.pathname !== "/")
    throw new AppError(
      "ISSUER_INVALID",
      "Cloudflare Access issuer must be an HTTPS origin",
      400,
    );
  return mode === "cloudflare-access" ? url.origin : url.toString();
}
