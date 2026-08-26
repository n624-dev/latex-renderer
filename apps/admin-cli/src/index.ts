#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Command } from "commander";
import { ADMIN_API_PREFIX, AppError, CLIENT_VERSION, PUBLIC_ORIGIN } from "@latex-renderer/shared";

const program = new Command().name("latex-render-admin").version(CLIENT_VERSION);
program.command("auth").command("login").requiredOption("--api-key-stdin").action(async () => {
  const key = (await readStdin()).trim();
  if (!/^lra_[a-f0-9]{32}_[A-Za-z0-9_-]{43}$/.test(key))
    throw new AppError("INVALID_KEY", "Input is not an admin API key", 400);
  await saveKey(key);
  process.stdout.write("Admin credential stored.\n");
});

const users = program.command("users");
users.command("list").action(async () => print(await request("GET", "/users")));
users.command("create").requiredOption("--email <email>").requiredOption("--display-name <name>").requiredOption("--role <role>").action(async (o: { email: string; displayName: string; role: string }) => print(await request("POST", "/users", o)));
users.command("disable").argument("<id>").requiredOption("--yes").action(async (id: string) => print(await request("POST", `/users/${id}/disable`, {})));
users.command("enable").argument("<id>").requiredOption("--yes").action(async (id: string) => print(await request("POST", `/users/${id}/enable`, {})));

const accounts = program.command("service-accounts");
accounts.command("list").action(async () => print(await request("GET", "/service-accounts")));
accounts.command("create").requiredOption("--user <id>").requiredOption("--name <name>").requiredOption("--client-type <type>").action(async (o: { user: string; name: string; clientType: string }) => print(await request("POST", "/service-accounts", { ownerUserId: o.user, name: o.name, clientType: o.clientType })));
accounts.command("disable").argument("<id>").requiredOption("--yes").action(async (id: string) => print(await request("POST", `/service-accounts/${id}/disable`, {})));
accounts.command("enable").argument("<id>").requiredOption("--yes").action(async (id: string) => print(await request("POST", `/service-accounts/${id}/enable`, {})));

const jobs = program.command("jobs");
jobs.command("retry").argument("<id>").requiredOption("--yes").action(async (id: string) => print(await request("POST", `/jobs/${id}/retry`, {}, { "Idempotency-Key": randomUUID() })));
const keys = program.command("api-keys");
keys.command("create").requiredOption("--service-account <id>").requiredOption("--name <name>").requiredOption("--scope <scope...>").action(async (o: { serviceAccount: string; name: string; scope: string[] }) => print(await request("POST", `/service-accounts/${o.serviceAccount}/api-keys`, { name: o.name, scopes: o.scope })));
keys.command("revoke").argument("<id>").requiredOption("--yes").action(async (id: string) => print(await request("POST", `/api-keys/${id}/revoke`, {})));
keys.command("rotate").argument("<id>").requiredOption("--yes").action(async (id: string) => print(await request("POST", `/api-keys/${id}/rotate`, {})));

const maintenance = program.command("maintenance");
maintenance.command("enable").requiredOption("--mode <mode>").requiredOption("--reason <reason>").requiredOption("--yes").action(async (o: { mode: string; reason: string }) => print(await request("POST", "/system/maintenance/enable", o)));
maintenance.command("disable").requiredOption("--yes").action(async () => print(await request("POST", "/system/maintenance/disable", {})));
const ticketKeys = program.command("ticket-keys");
ticketKeys.command("revoke").argument("<kid>").requiredOption("--reason <reason>").requiredOption("--expires-at <date>").requiredOption("--yes").action(async (kid: string, o: { reason: string; expiresAt: string }) => print(await request("POST", `/system/ticket-keys/${kid}/revoke`, { reason: o.reason, expiresAt: o.expiresAt })));
const worker = program.command("worker");
for (const action of ["pause", "resume", "drain"] as const)
  worker.command(action).requiredOption("--yes").action(async () => print(await request("POST", `/worker/${action}`, {})));

const tex = program.command("tex").description("Manage the TeX Live base image and language collections");
tex.command("status").action(async () => print(await request("GET", "/tex-environment/state")));
tex.command("images").action(async () => print(await request("GET", "/tex-environment/images")));
tex.command("languages")
  .option("--search <query>", "filter the shared language catalog without changing its server-provided order")
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
texCountry.command("set").argument("<country>").action(async (country: string) => print(await request("POST", "/tex-environment/country", { country: country.toUpperCase() })));
texCountry.command("clear").action(async () => print(await request("POST", "/tex-environment/country", { country: null })));
tex.command("apply")
  .requiredOption("--image <selector>", "latest, YYYY-MM-DD, weekly:YYYY-Www, or sha256:...")
  .option("--language <collection...>")
  .option("--all-languages", "select every language collection returned by the common API")
  .option("--clear-languages", "select zero optional language collections")
  .requiredOption("--auto-update <on|off>")
  .option("--rebuild-if-missing <on|off>", "rebuild an unavailable dated image locally", "on")
  .requiredOption("--yes")
  .action(async (o: { image: string; language?: string[]; allLanguages?: boolean; clearLanguages?: boolean; autoUpdate: string; rebuildIfMissing: string }) => {
    const selectionModes = Number(Boolean(o.allLanguages)) + Number(Boolean(o.clearLanguages)) + Number((o.language?.length ?? 0) > 0);
    if (selectionModes !== 1)
      throw new AppError("INVALID_OPTION", "Choose exactly one of --language, --all-languages, or --clear-languages", 400);
    let languages = o.clearLanguages ? [] : (o.language ?? []);
    if (o.allLanguages) {
      const catalog = asRecord(await request("GET", "/tex-environment/languages"));
      if (catalog.catalogUnavailable === true) {
        throw new AppError(
          "TEX_LANGUAGE_CATALOG_UNAVAILABLE",
          "Cannot use --all-languages while the TeX Live language catalog is unavailable",
          503,
        );
      }
      languages = Array.isArray(catalog.items)
        ? catalog.items.map((item) => asRecord(item).id).filter((id): id is string => typeof id === "string")
        : [];
    }
    await runTexMutation("/tex-environment/apply", {
      selector: parseImageSelector(o.image),
      languages,
      autoUpdate: parseOnOff(o.autoUpdate, "auto-update"),
      rebuildIfMissing: parseOnOff(o.rebuildIfMissing, "rebuild-if-missing"),
    });
  });
tex.command("operation").argument("<id>").action(async (id: string) => print(await request("GET", `/tex-environment/operations/${encodeURIComponent(id)}`)));
for (const [action, path] of [
  ["rollback", "/tex-environment/rollback"],
  ["revalidate", "/tex-environment/revalidate"],
  ["cleanup", "/tex-environment/cleanup"],
  ["refresh", "/tex-environment/refresh"],
] as const)
  tex.command(action).requiredOption("--yes").action(async () => runTexMutation(path, {}));
tex.command("packages").argument("[query]").action(async (query?: string) => print(await request("GET", `/tex-environment/inventory/packages${query ? `?q=${encodeURIComponent(query)}` : ""}`)));
tex.command("fonts").argument("[query]").action(async (query?: string) => print(await request("GET", `/tex-environment/inventory/fonts${query ? `?q=${encodeURIComponent(query)}` : ""}`)));

await program.parseAsync().catch((error: unknown) => {
  process.stderr.write(`latex-render-admin: ${error instanceof Error ? error.message : "Unknown error"}\n`);
  process.exitCode = 1;
});

async function request(method: string, path: string, body?: unknown, extraHeaders: Readonly<Record<string, string>> = {}): Promise<unknown> {
  const base = process.env.LATEX_RENDER_BASE_URL ?? process.env.LATEX_RENDER_ADMIN_API_URL ?? PUBLIC_ORIGIN;
  const response = await fetch(new URL(`${ADMIN_API_PREFIX}${path}`, base), {
    method,
    headers: {
      Authorization: `Bearer ${await loadKey()}`,
      "CF-Access-Client-Id": required("CF_ACCESS_CLIENT_ID"),
      "CF-Access-Client-Secret": required("CF_ACCESS_CLIENT_SECRET"),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: "error",
  });
  const value: unknown = await (response.json() as Promise<unknown>).catch(() => null);
  if (!response.ok) throw new AppError("ADMIN_HTTP_ERROR", JSON.stringify(value), response.status);
  return value;
}

async function runTexMutation(path: string, body: unknown): Promise<void> {
  const final = await waitTexOperation(await request("POST", path, body));
  print(final);
  const value = asRecord(final);
  if (value.status === "failed")
    throw new AppError("TEX_OPERATION_FAILED", typeof value.error === "string" ? value.error : "TeX environment operation failed", 500);
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
      current = await request("GET", `/tex-environment/operations/${encodeURIComponent(id)}`);
      failures = 0;
    } catch (error) {
      failures += 1;
      if (failures >= 60) throw error;
      if (lastStatus !== "reconnecting") {
        process.stderr.write("TeX environment: reconnecting to Admin API...\n");
        lastStatus = "reconnecting";
      }
      await sleep(1_000);
      continue;
    }
    const record = asRecord(current);
    const status = typeof record.status === "string" ? record.status : "unknown";
    if (status !== lastStatus) {
      process.stderr.write(`TeX environment: ${status}\n`);
      lastStatus = status;
    }
    if (status === "succeeded" || status === "failed") return current;
    await sleep(1_500);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}
function sleep(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }

const credentialPath = process.platform === "win32"
  ? join(process.env.APPDATA ?? homedir(), "latex-renderer", "admin-credential.bin")
  : join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "latex-renderer", "admin-credential");

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
  if (spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { input: key, env: { ...process.env, LR_PATH: credentialPath } }).status !== 0)
    throw new AppError("CREDENTIAL_FAILED", "DPAPI storage failed");
}
async function loadKey(): Promise<string> {
  if (process.env.LATEX_RENDER_ADMIN_API_KEY) return process.env.LATEX_RENDER_ADMIN_API_KEY;
  if (process.platform !== "win32") {
    const info = await lstat(credentialPath);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || info.uid !== (process.geteuid?.() ?? info.uid))
      throw new AppError("CREDENTIAL_PERMISSIONS", "Admin credential must be a regular file owned by the current user with mode 0600", 401);
    return (await readFile(credentialPath, "utf8")).trim();
  }
  const script = `$e=[IO.File]::ReadAllBytes($env:LR_PATH);$b=[Security.Cryptography.ProtectedData]::Unprotect($e,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($b))`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", env: { ...process.env, LR_PATH: credentialPath } });
  if (result.status !== 0) throw new AppError("CREDENTIAL_MISSING", "Admin credential missing", 401);
  return result.stdout;
}
async function readStdin(): Promise<string> {
  let value = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) value += String(chunk);
  return value;
}
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new AppError("CONFIG_REQUIRED", `${name} is required`);
  return value;
}
function print(value: unknown): void { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function parseOnOff(value: string, name: string): boolean {
  if (value === "on") return true;
  if (value === "off") return false;
  throw new AppError("INVALID_OPTION", `${name} must be on or off`, 400);
}
function parseImageSelector(value: string): { mode: "latest" | "date" | "weekly" | "digest"; value?: string | null } {
  if (value === "latest") return { mode: "latest", value: null };
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return { mode: "date", value };
  if (/^weekly:\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/.test(value)) return { mode: "weekly", value: value.slice(7) };
  if (/^sha256:[a-f0-9]{64}$/.test(value)) return { mode: "digest", value };
  throw new AppError("INVALID_IMAGE_SELECTOR", "Image must be latest, YYYY-MM-DD, weekly:YYYY-Www (01-53), or sha256:<digest>", 400);
}
