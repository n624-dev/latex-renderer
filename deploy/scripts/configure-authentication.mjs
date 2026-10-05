#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  parseEnvironmentFile,
  parseBrowserAuthenticationSelection,
  productionAuthenticationPlan,
  serverIngressFromEnvironment,
  importServerSetupReview,
  checkServerSetupOidc,
} from "../../packages/server-setup-core/src/index.mjs";
import { verifyProductionAuthSecrets } from "./validate-production-profile.mjs";
import {
  verifyProductionIngressTls,
  verifyIngressInterface,
} from "./server-ingress.mjs";
import { acquireMutationLock } from "./mutation-lock.mjs";
import {
  AuthenticationChangeStore,
  authenticationChangeReview,
  applyAuthenticationChange,
  recoverAuthenticationChange,
  serverSetupChangeReview,
  applyServerSetupChange,
  serverSetupUnits,
} from "./authentication-change.mjs";

export function requireServerSetupRecoveryOrdering(before, apiRequires) {
  const words = (value) =>
    typeof value === "string" && value.length <= 16 * 1024
      ? value.trim().split(/\s+/)
      : [];
  const ordering = words(before),
    requirements = words(apiRequires);
  if (
    !serverSetupUnits.every((unit) => ordering.includes(unit)) ||
    !requirements.includes("latex-renderer-authentication-recovery.service")
  )
    throw new Error(
      "Compatible recovery ordering is required before applying server settings",
    );
}

// Read-only check: no owner creation/reset, credential repair or email linking.
export function requireAuthenticationOwner(database, plan) {
  const row = database
    .prepare(
      `SELECT count(*) AS count FROM users u
    WHERE u.role='owner' AND u.status='active' AND (
      (? = 1 AND EXISTS(SELECT 1 FROM local_credentials c WHERE c.user_id=u.id)) OR
      (? <> '' AND EXISTS(SELECT 1 FROM user_identities i
        WHERE i.user_id=u.id AND i.provider=? AND i.issuer=?))
    )`,
    )
    .get(
      Number(plan.passwordEnabled),
      plan.externalIssuer,
      plan.authMode === "cloudflare-access" ? "cloudflare-access" : "oidc",
      plan.externalIssuer,
    );
  if (row.count < 1)
    throw new Error(
      "An active owner must have an explicitly provisioned enabled login method before cutover",
    );
}

const systemctl = (...args) =>
  execFileSync("/usr/bin/systemctl", args, {
    encoding: "utf8",
    // Worker SIGTERM drains its active render; do not time out systemctl while
    // its existing 15-minute stop job is still in progress.
    timeout:
      args[0] === "stop" && args[1] === "latex-renderer-worker.service"
        ? 16 * 60_000
        : 60_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
async function healthJson(response) {
  if (!response.ok || !response.body) throw new Error("Health response failed");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) throw new Error("Health response exceeds limit");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function checkAuthenticationHealth(
  contents,
  runtime = false,
  fetchImpl = globalThis.fetch,
  wait = delay,
) {
  const values = parseEnvironmentFile(contents);
  const selection = parseBrowserAuthenticationSelection(values);
  const methods =
    selection.backend === "cloudflare-access"
      ? []
      : [
          ...(selection.passwordEnabled ? [{ id: "password" }] : []),
          ...(selection.oidcEnabled
            ? [{ id: "oidc", displayName: selection.oidcDisplayName ?? "OIDC" }]
            : []),
        ];
  // Bounded startup allowance; local requests only, no fallback/provider call.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      for (const port of [3102, 3104]) {
        const response = await fetchImpl(
          `http://127.0.0.1:${port}/auth/config`,
          {
            redirect: "error",
            signal: globalThis.AbortSignal.timeout(2000),
          },
        );
        const value = await healthJson(response);
        if (
          value.backend !== selection.backend ||
          value.publicOrigin !==
            productionAuthenticationPlan(values).publicOrigin ||
          JSON.stringify(value.methods) !== JSON.stringify(methods)
        )
          throw new Error();
      }
      if (runtime)
        for (const port of [3100, 3103]) {
          const response = await fetchImpl(`http://127.0.0.1:${port}/health`, {
            redirect: "error",
            signal: globalThis.AbortSignal.timeout(2000),
          });
          if ((await healthJson(response)).status !== "ok") throw new Error();
        }
      return;
    } catch {
      /* No response/error body may enter privileged logs. */
    }
    if (attempt < 9) await wait(500);
  }
  throw new Error("Authentication policy readiness failed");
}

async function main() {
  if (process.geteuid?.() !== 0)
    throw new Error("configure-authentication.mjs must run as root");
  const [action, input, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    ![
      "--review",
      "--apply",
      "--setup-review",
      "--setup-apply",
      "--setup-export",
      "--recover",
      "--recover-before-start",
    ].includes(action) ||
    ["--review", "--apply", "--setup-review", "--setup-apply"].includes(
      action,
    ) !== Boolean(input)
  )
    throw new Error(
      "usage: configure-authentication.mjs --review FORMAT_2_JSON | --apply REVIEW_JSON | --setup-export | --setup-review FORMAT_4_JSON | --setup-apply REVIEW_JSON | --recover | --recover-before-start",
    );
  // A normal service start with no journal is read-only. In particular, a
  // release deployment may already own the shared mutation lock while it
  // starts these services; do not recursively acquire that lock in this case.
  if (action === "--recover-before-start") {
    const probe = new AuthenticationChangeStore(
      "/etc/latex-renderer/renderer.env",
      "/etc/latex-renderer/authentication-transaction",
    );
    if (!(await probe.journal())) return;
  }
  const lock = await acquireMutationLock();
  try {
    const gid = Number(
      execFileSync("/usr/bin/getent", ["group", "latex-renderer"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).split(":")[2],
    );
    if (!Number.isSafeInteger(gid) || gid < 0)
      throw new Error("Renderer group is unavailable");
    const store = new AuthenticationChangeStore(
      "/etc/latex-renderer/renderer.env",
      "/etc/latex-renderer/authentication-transaction",
      0,
      gid,
    );
    const setupOperation =
      action.startsWith("--setup-") || (await store.journal())?.format === 2;
    if (action === "--setup-export") {
      if (await store.journal())
        throw new Error("Recover the previous transaction first");
      process.stdout.write(
        `${JSON.stringify(importServerSetupReview(await store.environment()), null, 2)}\n`,
      );
      return;
    }
    const host = {
      active: (unit) => {
        const state = systemctl(
          "show",
          "--property=ActiveState",
          "--value",
          unit,
        ).trim();
        if (!["active", "inactive", "failed"].includes(state))
          throw new Error("Authentication unit state is indeterminate");
        return state === "active";
      },
      run: (action, unit) => {
        systemctl(action, unit);
      },
      health: (contents) => checkAuthenticationHealth(contents, setupOperation),
      preflight: async (contents) => {
        if (
          setupOperation &&
          !host.active("latex-renderer-authentication-recovery.service")
        )
          throw new Error(
            "Install and start the compatible recovery unit before server setup cutover",
          );
        if (setupOperation)
          requireServerSetupRecoveryOrdering(
            systemctl(
              "show",
              "--property=Before",
              "--value",
              "latex-renderer-authentication-recovery.service",
            ),
            systemctl(
              "show",
              "--property=Requires",
              "--value",
              "latex-renderer-api.service",
            ),
          );
        const values = parseEnvironmentFile(contents);
        const plan = productionAuthenticationPlan(values);
        if (
          setupOperation &&
          importServerSetupReview(contents).runtime.databasePath !==
            "/var/lib/latex-renderer/renderer.sqlite3"
        )
          throw new Error(
            "Server setup requires the existing managed database path",
          );
        const ingress = serverIngressFromEnvironment(values);
        verifyProductionIngressTls(ingress, gid);
        verifyIngressInterface(ingress);
        verifyProductionAuthSecrets(plan, gid);
        const database = new DatabaseSync(
          "/var/lib/latex-renderer/renderer.sqlite3",
          { readOnly: true },
        );
        try {
          requireAuthenticationOwner(database, plan);
        } finally {
          database.close();
        }
        if (setupOperation)
          await checkServerSetupOidc(importServerSetupReview(contents));
      },
    };
    if (action.startsWith("--recover")) {
      await recoverAuthenticationChange(
        store,
        host,
        action === "--recover-before-start",
      );
      process.stdout.write("Authentication recovery complete\n");
      return;
    }
    if (!input.startsWith("/") || resolve(input) !== input)
      throw new Error(
        "Review must be an absolute canonical root-owned private file",
      );
    for (let parent = dirname(input); ; parent = dirname(parent)) {
      const info = await lstat(parent);
      if (
        !info.isDirectory() ||
        info.uid !== 0 ||
        info.mode & 0o022 ||
        (await realpath(parent)) !== parent
      )
        throw new Error(
          "Authentication review directory must be root controlled",
        );
      if (parent === "/") break;
    }
    const model = JSON.parse(await store.read(input, 0o600, 0, 128 * 1024));
    if (action === "--review" || action === "--setup-review") {
      await store.initialize();
      if (await store.journal())
        throw new Error(
          "Recover the previous authentication transaction first",
        );
      const review = (
        setupOperation ? serverSetupChangeReview : authenticationChangeReview
      )(await store.environment(), model);
      // Only non-secret profile metadata and hashes; never the complete env.
      process.stdout.write(`${JSON.stringify(review.envelope, null, 2)}\n`);
    } else {
      await (
        setupOperation ? applyServerSetupChange : applyAuthenticationChange
      )(store, host, model);
      process.stdout.write(
        setupOperation
          ? "Server settings change completed; verify owner login and a representative render\n"
          : "Authentication change completed; verify owner login before removing old credentials\n",
      );
    }
  } finally {
    await lock.release();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(() => {
    // Provider/DB/filesystem errors can contain secrets or raw EnvironmentFile
    // fragments. Use a fixed diagnostic; inspect only private host state.
    process.stderr.write(
      "Authentication operation failed; configuration was not certified. Recover any pending transaction and review private host state.\n",
    );
    process.exitCode = 1;
  });
}
