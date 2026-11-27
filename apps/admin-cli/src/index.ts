#!/usr/bin/env node
import { humanText, humanDiagnostic } from "./messages.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Command } from "commander";
import {
  ADMIN_API_PREFIX,
  AppError,
  CLIENT_VERSION,
  PUBLIC_ORIGIN,
} from "@latex-renderer/shared";
import { adminApiBaseUrl } from "./base-url.js";
import { openAdminMenu } from "./menu.js";
import {
  pollUpdateOperation,
  UpdateOperationUnconfirmedError,
} from "./update-operation.js";

const credentialPath =
  process.platform === "win32"
    ? join(
        process.env.APPDATA ?? homedir(),
        "latex-renderer",
        "admin-credential.bin",
      )
    : join(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "latex-renderer",
        "admin-credential",
      );

const program = new Command()
  .name("latex-render-admin")
  .version(CLIENT_VERSION)
  .option("--json", "write the result as JSON");
program
  .command("auth")
  .command("login")
  .requiredOption("--api-key-stdin")
  .action(async () => {
    const key = (await readStdin()).trim();
    if (!/^lra_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(key))
      throw new AppError("INVALID_KEY", "Input is not an admin API key", 400);
    await saveKey(key);
    process.stdout.write(humanText("adminCredentialStored") + "\n");
  });

const users = program.command("users");
addReadCommands(users, "/users");
users
  .command("create")
  .option("--email <email>")
  .requiredOption("--display-name <name>")
  .requiredOption("--role <role>")
  .requiredOption("--authentication <type>", "password or external")
  .option("--login-name <name>", humanText("passwordLoginName"))
  .option("--password-stdin", humanText("readTheInitialPasswordFromStandard"))
  .option("--subject <subject>", humanText("externalProviderSubject"))
  .option("--preferred-username <name>")
  .option("--email-at-provider <email>")
  .action(
    async (o: {
      email?: string;
      displayName: string;
      role: string;
      authentication: string;
      loginName?: string;
      passwordStdin?: boolean;
      subject?: string;
      preferredUsername?: string;
      emailAtProvider?: string;
    }) => {
      if (
        !["password", "external"].includes(o.authentication) ||
        (o.authentication === "password"
          ? !o.loginName ||
            !o.passwordStdin ||
            o.subject !== undefined ||
            o.preferredUsername !== undefined ||
            o.emailAtProvider !== undefined
          : !o.subject || o.loginName !== undefined || o.passwordStdin)
      )
        throw new AppError(
          "INVALID_OPTION",
          "Choose password with --login-name and --password-stdin, or external with --subject",
          400,
        );
      const authentication =
        o.authentication === "password"
          ? {
              type: "password",
              loginName: o.loginName,
              password: (await readStdin()).replace(/\r?\n$/, ""),
            }
          : {
              type: "external",
              subject: o.subject,
              ...(o.preferredUsername === undefined
                ? {}
                : { preferredUsername: o.preferredUsername }),
              ...(o.emailAtProvider === undefined
                ? {}
                : { emailAtProvider: o.emailAtProvider }),
            };
      print(
        await request("POST", "/users", {
          displayName: o.displayName,
          role: o.role,
          ...(o.email === undefined ? {} : { email: o.email }),
          authentication,
        }),
      );
    },
  );
users
  .command("disable")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(await request("POST", `/users/${id}/disable`, {})),
  );
users
  .command("enable")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(await request("POST", `/users/${id}/enable`, {})),
  );
users
  .command("update")
  .description("Update a user's display name, email, or role")
  .argument("<id>")
  .option("--display-name <name>")
  .option("--email <email>")
  .option("--clear-email")
  .option("--role <role>")
  .requiredOption("--yes")
  .action(
    async (
      id: string,
      options: {
        displayName?: string;
        email?: string;
        clearEmail?: boolean;
        role?: string;
      },
    ) => {
      const { displayName, email, clearEmail, role } = options;
      if (
        (clearEmail && email !== undefined) ||
        (!clearEmail &&
          [displayName, email, role].every((value) => value === undefined))
      )
        throw new AppError(
          "INVALID_OPTION",
          "Choose fields to update; use either --email or --clear-email",
          400,
        );
      print(
        await request("PATCH", `/users/${encodeURIComponent(id)}`, {
          displayName,
          email: clearEmail ? null : email,
          role,
        }),
      );
    },
  );
users
  .command("set-password")
  .description("Update a user's password and revoke their active sessions")
  .argument("<id>")
  .requiredOption("--login-name <name>")
  .requiredOption(
    "--password-stdin",
    humanText("readTheInitialPasswordFromStandard"),
  )
  .requiredOption("--reason <reason>")
  .requiredOption("--yes")
  .action(
    async (id: string, options: { loginName: string; reason: string }) => {
      const password = (await readStdin()).replace(/\r?\n$/, "");
      print(
        await request("POST", `/users/${encodeURIComponent(id)}/password`, {
          loginName: options.loginName,
          password,
          reason: options.reason,
        }),
      );
    },
  );
users
  .command("unlink-identity")
  .description("Unlink an external login identity from a user")
  .argument("<id>")
  .argument("<identity-id>")
  .requiredOption("--reason <reason>")
  .requiredOption("--yes")
  .action(async (id: string, identity: string, options: { reason: string }) =>
    print(
      await request(
        "POST",
        `/users/${encodeURIComponent(id)}/identities/${encodeURIComponent(identity)}/unlink`,
        {
          reason: options.reason,
        },
      ),
    ),
  );

const accounts = program.command("service-accounts");
addReadCommands(accounts, "/service-accounts");
accounts
  .command("create")
  .requiredOption("--user <id>")
  .requiredOption("--name <name>")
  .requiredOption("--client-type <type>")
  .action(async (o: { user: string; name: string; clientType: string }) =>
    print(
      await request("POST", "/service-accounts", {
        ownerUserId: o.user,
        name: o.name,
        clientType: o.clientType,
      }),
    ),
  );
accounts
  .command("disable")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(await request("POST", `/service-accounts/${id}/disable`, {})),
  );
accounts
  .command("enable")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(await request("POST", `/service-accounts/${id}/enable`, {})),
  );
accounts
  .command("update")
  .description("Update a service account's name or client type")
  .argument("<id>")
  .option("--name <name>")
  .option("--client-type <type>")
  .requiredOption("--yes")
  .action(
    async (
      id: string,
      { name, clientType }: { name?: string; clientType?: string },
    ) => {
      if (name === undefined && clientType === undefined)
        throw new AppError(
          "INVALID_OPTION",
          "Supply --name or --client-type",
          400,
        );
      print(
        await request("PATCH", `/service-accounts/${encodeURIComponent(id)}`, {
          name,
          clientType,
        }),
      );
    },
  );
accounts
  .command("delete")
  .description("Disable a service account and revoke all of its API keys")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) => {
    await request("DELETE", `/service-accounts/${encodeURIComponent(id)}`);
    print({ id, disabled: true });
  });

const jobs = program.command("jobs");
addReadCommands(jobs, "/jobs", ["--status <status>", "--source-id <id>"]);
jobs
  .command("download")
  .description(
    "Download an individual artifact or a ZIP of the available artifacts",
  )
  .argument("<id>")
  .requiredOption("--output <path>")
  .option("--artifact <name>", "relative artifact path, for example result.pdf")
  .action(
    async (id: string, options: { output: string; artifact?: string }) => {
      if (!/^job_[a-f0-9]{32}$/.test(id))
        throw new AppError("INVALID_JOB_ID", "A valid Job ID is required", 400);
      const name = options.artifact;
      const base = `/jobs/${encodeURIComponent(id)}`;
      let path = `${base}/archive`;
      if (name !== undefined) {
        const parts = name.split("/");
        if (parts.some((part) => !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part)))
          throw new AppError(
            "INVALID_ARTIFACT",
            "Use the relative artifact path listed by jobs get",
            400,
          );
        const collection =
          parts.length === 2 && parts[0] === "previews" ? "" : "artifacts/";
        path = `${base}/${collection}${parts.map(encodeURIComponent).join("/")}`;
      }
      await download(path, options.output);
      print({ id, output: options.output, artifact: name ?? null });
    },
  );
jobs
  .command("render-targets")
  .description("List available render credentials and input limits")
  .action(async () => print(await request("GET", "/jobs/render-targets")));
jobs
  .command("bulk-delete")
  .description("Delete a list of completed jobs")
  .argument("<ids...>")
  .requiredOption("--yes")
  .action(async (ids: string[]) =>
    print(await request("POST", "/jobs/bulk-delete", { ids })),
  );
jobs
  .command("cancel")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(await request("POST", `/jobs/${encodeURIComponent(id)}/cancel`)),
  );
jobs
  .command("delete")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) => {
    await request("DELETE", `/jobs/${encodeURIComponent(id)}`);
    print({ id, accepted: true });
  });
jobs
  .command("retry-svg")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(
      await request(
        "POST",
        `/jobs/${encodeURIComponent(id)}/retry-svg`,
        undefined,
        {
          "Idempotency-Key": randomUUID(),
        },
      ),
    ),
  );
jobs
  .command("retry")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(
      await request(
        "POST",
        `/jobs/${id}/retry`,
        {},
        { "Idempotency-Key": randomUUID() },
      ),
    ),
  );
const keys = program.command("api-keys");
addReadCommands(keys, "/api-keys");
keys
  .command("create")
  .requiredOption("--service-account <id>")
  .requiredOption("--name <name>")
  .requiredOption("--scope <scope...>")
  .action(
    async (o: { serviceAccount: string; name: string; scope: string[] }) =>
      print(
        await request(
          "POST",
          `/service-accounts/${o.serviceAccount}/api-keys`,
          { name: o.name, scopes: o.scope },
        ),
      ),
  );
keys
  .command("revoke")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(await request("POST", `/api-keys/${id}/revoke`, {})),
  );
keys
  .command("rotate")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) =>
    print(await request("POST", `/api-keys/${id}/rotate`, {})),
  );

const maintenance = program.command("maintenance");
maintenance.command("status").action(async () => {
  const status = asRecord(await request("GET", "/system/status"));
  print({ maintenance: status.maintenance });
});
maintenance
  .command("enable")
  .requiredOption("--mode <mode>")
  .requiredOption("--reason <reason>")
  .requiredOption("--yes")
  .action(async (o: { mode: string; reason: string }) =>
    print(
      await request("POST", "/system/maintenance/enable", {
        mode: o.mode,
        reason: o.reason,
      }),
    ),
  );
maintenance
  .command("disable")
  .requiredOption("--yes")
  .action(async () =>
    print(await request("POST", "/system/maintenance/disable", {})),
  );
const ticketKeys = program.command("ticket-keys");
ticketKeys
  .command("list")
  .action(async () => print(await request("GET", "/system/ticket-keys")));
ticketKeys
  .command("revoke")
  .argument("<kid>")
  .requiredOption("--reason <reason>")
  .requiredOption("--expires-at <date>")
  .requiredOption("--yes")
  .action(async (kid: string, o: { reason: string; expiresAt: string }) =>
    print(
      await request("POST", `/system/ticket-keys/${kid}/revoke`, {
        reason: o.reason,
        expiresAt: o.expiresAt,
      }),
    ),
  );
const worker = program.command("worker");
worker.command("status").action(async () => {
  const status = asRecord(await request("GET", "/system/status"));
  print({ worker: status.worker, rendering: status.rendering });
});
for (const action of ["pause", "resume", "drain"] as const)
  worker
    .command(action)
    .requiredOption("--yes")
    .action(async () => print(await request("POST", `/worker/${action}`, {})));

const sources = program.command("sources");
addReadCommands(sources, "/sources", ["--status <status>"]);
sources
  .command("render")
  .description("Render an existing source with the specified render API key ID")
  .argument("<id>")
  .requiredOption("--api-key-id <id>")
  .option("--entrypoint <path>")
  .option("--svg")
  .option("--idempotency-key <key>")
  .requiredOption("--yes")
  .action(
    async (
      id: string,
      options: {
        apiKeyId: string;
        entrypoint?: string;
        svg?: boolean;
        idempotencyKey?: string;
      },
    ) =>
      print(
        await request(
          "POST",
          `/sources/${encodeURIComponent(id)}/render`,
          {
            apiKeyId: options.apiKeyId,
            entrypoint: options.entrypoint,
            outputs: options.svg ? ["pdf", "svg"] : ["pdf"],
          },
          { "Idempotency-Key": options.idempotencyKey ?? randomUUID() },
        ),
      ),
  );
sources
  .command("reference")
  .description(
    "Issue a short-lived source reference for the specified render API key ID",
  )
  .argument("<id>")
  .requiredOption("--api-key-id <id>")
  .requiredOption("--yes")
  .action(async (id: string, { apiKeyId }: { apiKeyId: string }) =>
    print(
      await request("POST", `/sources/${encodeURIComponent(id)}/source-ref`, {
        apiKeyId,
      }),
    ),
  );
sources
  .command("delete")
  .description("Delete an unreferenced source")
  .argument("<id>")
  .requiredOption("--yes")
  .action(async (id: string) => {
    await request("DELETE", `/sources/${encodeURIComponent(id)}`);
    print({ id, accepted: true });
  });
const system = program.command("system");
system
  .command("status")
  .action(async () => print(await request("GET", "/system/status")));
const systemConfig = system
  .command("config")
  .action(async () => print(await request("GET", "/system/config")));
systemConfig
  .command("set")
  .argument("<key>")
  .argument("<value>")
  .requiredOption("--reason <reason>")
  .requiredOption("--yes")
  .action(async (key: string, raw: string, options: { reason: string }) => {
    const value = Number(raw);
    if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(value) || value < 1)
      throw new AppError(
        "INVALID_OPTION",
        "The value must be a positive integer",
        400,
      );
    print(
      await request("PATCH", "/system/config", {
        key,
        value,
        reason: options.reason,
      }),
    );
  });

const backup = program.command("backup");
backup
  .command("status")
  .action(async () => print(await request("GET", "/backups/status")));
for (const action of ["create", "verify"] as const)
  backup
    .command(action)
    .action(async () => print(await request("POST", `/backups/${action}`)));

program
  .command("audit")
  .command("list")
  .option("--page <page>")
  .option("--page-size <size>")
  .option("--action <action>")
  .option("--actor <actor>")
  .option("--target <target>")
  .option("--result <result>")
  .option("--from <timestamp>")
  .option("--to <timestamp>")
  .action(async (filters: Record<string, string>) =>
    print(await request("GET", withQuery("/audit-logs", filters))),
  );

const tex = program
  .command("tex")
  .description(humanText("manageTheTexLiveBaseImage"));
tex
  .command("status")
  .action(async () => print(await request("GET", "/tex-environment/state")));
tex
  .command("images")
  .action(async () => print(await request("GET", "/tex-environment/images")));
tex
  .command("languages")
  .option(
    "--search <query>",
    humanText("filterTheSharedLanguageCatalogWithout"),
  )
  .action(async (o: { search?: string }) => {
    const value = asRecord(await request("GET", "/tex-environment/languages"));
    const query = o.search?.trim().toLocaleLowerCase("en") ?? "";
    const items = Array.isArray(value.items)
      ? value.items.filter((entry) => {
          if (!query) return true;
          const item = asRecord(entry);
          return [item.id, item.name, item.description]
            .filter((part): part is string => typeof part === "string")
            .some((part) => part.toLocaleLowerCase("en").includes(query));
        })
      : [];
    print({ ...value, items });
  });
const texCountry = tex.command("country");
texCountry
  .command("set")
  .argument("<country>")
  .action(async (country: string) =>
    print(
      await request("POST", "/tex-environment/country", {
        country: country.toUpperCase(),
      }),
    ),
  );
texCountry
  .command("clear")
  .action(async () =>
    print(await request("POST", "/tex-environment/country", { country: null })),
  );
tex
  .command("apply")
  .requiredOption(
    "--image <selector>",
    "latest, YYYY-MM-DD, weekly:YYYY-Www, or sha256:...",
  )
  .option("--language <collection...>")
  .option(
    "--all-languages",
    humanText("selectEveryLanguageCollectionReturnedBy"),
  )
  .option(
    "--clear-languages",
    humanText("selectZeroOptionalLanguageCollections"),
  )
  .requiredOption("--auto-update <on|off>")
  .option(
    "--rebuild-if-missing <on|off>",
    humanText("rebuildAnUnavailableDatedImageLocally"),
    "on",
  )
  .requiredOption("--reason <reason>", "reason recorded in the audit log")
  .requiredOption("--yes")
  .action(
    async (o: {
      image: string;
      language?: string[];
      allLanguages?: boolean;
      clearLanguages?: boolean;
      autoUpdate: string;
      rebuildIfMissing: string;
      reason: string;
    }) => {
      const selectionModes =
        Number(Boolean(o.allLanguages)) +
        Number(Boolean(o.clearLanguages)) +
        Number((o.language?.length ?? 0) > 0);
      if (selectionModes !== 1)
        throw new AppError(
          "INVALID_OPTION",
          "Choose exactly one of --language, --all-languages, or --clear-languages",
          400,
        );
      let languages = o.clearLanguages ? [] : (o.language ?? []);
      if (o.allLanguages) {
        const catalog = asRecord(
          await request("GET", "/tex-environment/languages"),
        );
        if (catalog.catalogUnavailable === true) {
          throw new AppError(
            "TEX_LANGUAGE_CATALOG_UNAVAILABLE",
            "Cannot use --all-languages while the TeX Live language catalog is unavailable",
            503,
          );
        }
        languages = Array.isArray(catalog.items)
          ? catalog.items
              .map((item) => asRecord(item).id)
              .filter((id): id is string => typeof id === "string")
          : [];
      }
      await runTexMutation("/tex-environment/apply", {
        selector: parseImageSelector(o.image),
        languages,
        autoUpdate: parseOnOff(o.autoUpdate, "auto-update"),
        rebuildIfMissing: parseOnOff(o.rebuildIfMissing, "rebuild-if-missing"),
        reason: o.reason,
      });
    },
  );
tex
  .command("operation")
  .argument("<id>")
  .action(async (id: string) =>
    print(
      await request(
        "GET",
        `/tex-environment/operations/${encodeURIComponent(id)}`,
      ),
    ),
  );
for (const [action, path] of [
  ["rollback", "/tex-environment/rollback"],
  ["revalidate", "/tex-environment/revalidate"],
  ["cleanup", "/tex-environment/cleanup"],
  ["refresh", "/tex-environment/refresh"],
] as const)
  tex
    .command(action)
    .requiredOption("--reason <reason>", "reason recorded in the audit log")
    .requiredOption("--yes")
    .action(async (o: { reason: string }) =>
      runTexMutation(path, { reason: o.reason }),
    );
tex
  .command("packages")
  .argument("[query]")
  .action(async (query?: string) =>
    print(
      await request(
        "GET",
        `/tex-environment/inventory/packages${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      ),
    ),
  );
tex
  .command("fonts")
  .argument("[query]")
  .action(async (query?: string) =>
    print(
      await request(
        "GET",
        `/tex-environment/inventory/fonts${query ? `?q=${encodeURIComponent(query)}` : ""}`,
      ),
    ),
  );

const update = program
  .command("update")
  .description(humanText("updateTheSelfHostedLatexRenderer"));
update
  .command("status")
  .action(async () => print(await request("GET", "/updates/state")));
update
  .command("check")
  .argument("[version]")
  .action(async (version?: string) =>
    print(await request("POST", "/updates/check", version ? { version } : {})),
  );
update
  .command("policy")
  .requiredOption("--mode <notify|automatic>")
  .requiredOption("--reason <reason>", "reason recorded in the audit log")
  .requiredOption("--yes")
  .action(async (options: { mode: string; reason: string }) => {
    if (
      !(["notify", "automatic"] as const).includes(
        options.mode as "notify" | "automatic",
      )
    ) {
      throw new AppError(
        "INVALID_OPTION",
        "mode must be notify or automatic",
        400,
      );
    }
    print(
      await request("POST", "/updates/policy", {
        channel: "stable",
        mode: options.mode,
        reason: options.reason,
      }),
    );
  });
update
  .command("refresh")
  .requiredOption("--reason <reason>", "reason recorded in the audit log")
  .requiredOption("--yes")
  .action(async (options: { reason: string }) =>
    print(
      await request("POST", "/updates/refresh", { reason: options.reason }),
    ),
  );
update
  .command("apply")
  .argument("[version]")
  .requiredOption("--reason <reason>", "reason recorded in the audit log")
  .requiredOption("--yes")
  .action(async (version: string | undefined, options: { reason: string }) =>
    runUpdateMutation("/updates/apply", {
      ...(version ? { version } : {}),
      reason: options.reason,
    }),
  );
update
  .command("rollback")
  .requiredOption("--reason <reason>", "reason recorded in the audit log")
  .requiredOption("--yes")
  .action(async (options: { reason: string }) =>
    runUpdateMutation("/updates/rollback", { reason: options.reason }),
  );
update
  .command("operation")
  .argument("<id>")
  .action(async (id: string) =>
    print(
      await request("GET", `/updates/operations/${encodeURIComponent(id)}`),
    ),
  );

let terminalSecret: string | undefined;
await run().catch((error: unknown) => {
  process.stderr.write(
    `latex-render-admin: ${error instanceof Error ? humanDiagnostic(error.message) : humanDiagnostic("Unknown error")}\n`,
  );
  process.exitCode = 1;
});

async function run(): Promise<void> {
  if (
    process.argv.length !== 2 ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    await program.parseAsync();
    return;
  }
  const invocation = await openAdminMenu(program);
  if (invocation === undefined) return;
  terminalSecret = invocation.secret;
  delete invocation.secret;
  try {
    await program.parseAsync(invocation.args, { from: "user" });
  } finally {
    terminalSecret = undefined;
  }
}

function addReadCommands(
  group: Command,
  path: string,
  extraFlags: readonly string[] = [],
): void {
  const list = group
    .command("list")
    .option("--page-size <size>")
    .option("--cursor <cursor>")
    .option("--query <query>");
  for (const flag of extraFlags) list.option(flag);
  list.action(async (filters: Record<string, string>) =>
    print(await request("GET", withQuery(path, filters))),
  );
  group
    .command("get")
    .argument("<id>")
    .action(async (id: string) =>
      print(await request("GET", `${path}/${encodeURIComponent(id)}`)),
    );
}

function withQuery(
  path: string,
  filters: Readonly<Record<string, string>>,
): string {
  const query = new URLSearchParams(filters).toString();
  return query ? `${path}?${query}` : path;
}

async function request(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await adminFetch(method, path, body, extraHeaders, signal);
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok)
    throw new AppError(
      "ADMIN_HTTP_ERROR",
      JSON.stringify(value),
      response.status,
    );
  return value;
}

async function adminFetch(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
  signal?: AbortSignal,
): Promise<Response> {
  const base = adminApiBaseUrl(
    process.env.LATEX_RENDER_BASE_URL ?? process.env.LATEX_RENDER_ADMIN_API_URL,
    PUBLIC_ORIGIN,
    process.env.LATEX_RENDER_TRUSTED_ADMIN_ORIGINS,
  );
  const accessId = process.env.CF_ACCESS_CLIENT_ID,
    accessSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (Boolean(accessId) !== Boolean(accessSecret))
    throw new AppError(
      "CONFIG_REQUIRED",
      "Configure both Cloudflare Access service-token fields, or neither for Standalone",
      400,
    );
  return fetch(new URL(`${ADMIN_API_PREFIX}${path}`, base), {
    method,
    headers: {
      Authorization: `Bearer ${await loadKey()}`,
      ...(accessId && accessSecret
        ? {
            "CF-Access-Client-Id": accessId,
            "CF-Access-Client-Secret": accessSecret,
          }
        : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
    ...(signal === undefined ? {} : { signal }),
  });
}

async function download(path: string, destination: string): Promise<void> {
  const temporary = await mkdtemp(
    join(dirname(destination), ".latex-renderer-download-"),
  );
  try {
    const response = await adminFetch(
      "GET",
      path,
      undefined,
      {},
      AbortSignal.timeout(30 * 60_000),
    );
    if (!response.ok) {
      const value: unknown = await response.json().catch(() => null);
      throw new AppError(
        "ADMIN_HTTP_ERROR",
        JSON.stringify(value),
        response.status,
      );
    }
    if (response.body === null)
      throw new AppError(
        "DOWNLOAD_EMPTY",
        "The download returned no content",
        502,
      );
    const staged = join(temporary, "download");
    await pipeline(
      Readable.fromWeb(
        response.body as import("node:stream/web").ReadableStream<Uint8Array>,
      ),
      createWriteStream(staged, { flags: "wx", mode: 0o600 }),
    );
    await link(staged, destination);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

async function runTexMutation(path: string, body: unknown): Promise<void> {
  const final = await waitTexOperation(await request("POST", path, body));
  print(final);
  const value = asRecord(final);
  if (value.status === "failed")
    throw new AppError(
      "TEX_OPERATION_FAILED",
      typeof value.error === "string"
        ? value.error
        : "TeX environment operation failed",
      500,
    );
}

async function waitTexOperation(initial: unknown): Promise<unknown> {
  const value = asRecord(initial);
  if (typeof value.id !== "string") return initial;
  const id = value.id;
  let lastStatus = "";
  let failures = 0;
  for (;;) {
    let current: unknown;
    try {
      current = await request(
        "GET",
        `/tex-environment/operations/${encodeURIComponent(id)}`,
      );
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= 60) throw error;
      if (lastStatus !== "reconnecting") {
        process.stderr.write(
          humanText("texEnvironmentReconnectingToAdminApi") + "\n",
        );
        lastStatus = "reconnecting";
      }
      await sleep(1_000);
      continue;
    }
    const record = asRecord(current);
    const status =
      typeof record.status === "string" ? record.status : "unknown";
    if (status !== lastStatus) {
      process.stderr.write(`TeX environment: ${status}\n`);
      lastStatus = status;
    }
    if (status === "succeeded" || status === "failed") return current;
    await sleep(1_500);
  }
}

async function runUpdateMutation(path: string, body: unknown): Promise<void> {
  const final = await waitUpdateOperation(await request("POST", path, body));
  print(final);
  const value = asRecord(final);
  if (value.status === "failed")
    throw new AppError(
      "UPDATE_OPERATION_FAILED",
      typeof value.error === "string"
        ? value.error
        : "Application update failed",
      500,
    );
}

async function waitUpdateOperation(initial: unknown): Promise<unknown> {
  try {
    return await pollUpdateOperation(initial, {
      read: (id, timeoutMs) =>
        request(
          "GET",
          `/updates/operations/${encodeURIComponent(id)}`,
          undefined,
          {},
          AbortSignal.timeout(timeoutMs),
        ),
      sleep,
      now: () => performance.now(),
      onOperation: (id) =>
        process.stderr.write(`Application update operation: ${id}\n`),
      onStatus: (status) =>
        process.stderr.write(`Application update: ${status}\n`),
    });
  } catch (error) {
    if (error instanceof UpdateOperationUnconfirmedError)
      throw new AppError("UPDATE_OPERATION_UNCONFIRMED", error.message, 503);
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function saveKey(key: string): Promise<void> {
  await mkdir(dirname(credentialPath), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    const temporary = `${credentialPath}.part-${randomUUID()}`;
    try {
      await writeFile(temporary, key, { mode: 0o600, flag: "wx" });
      await chmod(temporary, 0o600);
      await rename(temporary, credentialPath);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return;
  }
  const script = `$b=[Text.Encoding]::UTF8.GetBytes([Console]::In.ReadToEnd().Trim());$e=[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[IO.File]::WriteAllBytes($env:LR_PATH,$e)`;
  if (
    spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { input: key, env: { ...process.env, LR_PATH: credentialPath } },
    ).status !== 0
  )
    throw new AppError("CREDENTIAL_FAILED", "DPAPI storage failed");
}
async function loadKey(): Promise<string> {
  if (process.env.LATEX_RENDER_ADMIN_API_KEY)
    return process.env.LATEX_RENDER_ADMIN_API_KEY;
  if (process.platform !== "win32") {
    const info = await lstat(credentialPath);
    if (
      !info.isFile() ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== (process.geteuid?.() ?? info.uid)
    )
      throw new AppError(
        "CREDENTIAL_PERMISSIONS",
        "Admin credential must be a regular file owned by the current user with mode 0600",
        401,
      );
    return (await readFile(credentialPath, "utf8")).trim();
  }
  const script = `$e=[IO.File]::ReadAllBytes($env:LR_PATH);$b=[Security.Cryptography.ProtectedData]::Unprotect($e,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", script],
    { encoding: "utf8", env: { ...process.env, LR_PATH: credentialPath } },
  );
  if (result.status !== 0)
    throw new AppError("CREDENTIAL_MISSING", "Admin credential missing", 401);
  return result.stdout;
}
async function readStdin(): Promise<string> {
  if (terminalSecret !== undefined) {
    const value = terminalSecret;
    terminalSecret = undefined;
    return boundedCredential(value);
  }
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin)
    value = boundedCredential(value + String(chunk));
  return value;
}

function boundedCredential(value: string): string {
  if (Buffer.byteLength(value, "utf8") > 8192)
    throw new AppError(
      "INPUT_TOO_LARGE",
      "Credential input exceeds the size limit",
      400,
    );
  return value;
}
function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
function parseOnOff(value: string, name: string): boolean {
  if (value === "on") return true;
  if (value === "off") return false;
  throw new AppError("INVALID_OPTION", `${name} must be on or off`, 400);
}
function parseImageSelector(value: string): {
  mode: "latest" | "date" | "weekly" | "digest";
  value?: string | null;
} {
  if (value === "latest") return { mode: "latest", value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { mode: "date", value };
  if (/^weekly:\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value))
    return { mode: "weekly", value: value.slice(7) };
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return { mode: "digest", value };
  throw new AppError(
    "INVALID_IMAGE_SELECTOR",
    "Image must be latest, YYYY-MM-DD, weekly:YYYY-Www (01-53), or sha256:<digest>",
    400,
  );
}
