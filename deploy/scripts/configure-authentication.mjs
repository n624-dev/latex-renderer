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
} from "../../packages/server-setup-core/src/index.mjs";
import { verifyProductionAuthSecrets } from "./validate-production-profile.mjs";
import { acquireMutationLock } from "./mutation-lock.mjs";
import {
  AuthenticationChangeStore,
  authenticationChangeReview,
  applyAuthenticationChange,
  recoverAuthenticationChange,
} from "./authentication-change.mjs";

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
    timeout: 60_000,
    stdio: ["ignore", "pipe", "ignore"],
  });
async function hostHealth(contents) {
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
        const response = await globalThis.fetch(
          `http://127.0.0.1:${port}/auth/config`,
          {
            redirect: "error",
            signal: globalThis.AbortSignal.timeout(2000),
          },
        );
        if (!response.ok) throw new Error();
        const text = await response.text();
        if (text.length > 8192) throw new Error();
        const value = JSON.parse(text);
        if (
          value.backend !== selection.backend ||
          value.publicOrigin !==
            productionAuthenticationPlan(values).publicOrigin ||
          JSON.stringify(value.methods) !== JSON.stringify(methods)
        )
          throw new Error();
      }
      return;
    } catch {
      /* No response/error body may enter privileged logs. */
    }
    if (attempt < 9) await delay(500);
  }
  throw new Error("Authentication policy readiness failed");
}

async function main() {
  if (process.geteuid?.() !== 0)
    throw new Error("configure-authentication.mjs must run as root");
  const [action, input, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    !["--review", "--apply", "--recover", "--recover-before-start"].includes(
      action,
    ) ||
    ["--review", "--apply"].includes(action) !== Boolean(input)
  )
    throw new Error(
      "usage: configure-authentication.mjs --review FORMAT_2_JSON | --apply REVIEW_JSON | --recover | --recover-before-start",
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
      health: hostHealth,
      preflight: (contents) => {
        const plan = productionAuthenticationPlan(
          parseEnvironmentFile(contents),
        );
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
    if (action === "--review") {
      await store.initialize();
      if (await store.journal())
        throw new Error(
          "Recover the previous authentication transaction first",
        );
      const review = authenticationChangeReview(
        await store.environment(),
        model,
      );
      // Only non-secret profile metadata and hashes; never the complete env.
      process.stdout.write(`${JSON.stringify(review.envelope, null, 2)}\n`);
    } else {
      await applyAuthenticationChange(store, host, model);
      process.stdout.write(
        "Authentication change completed; verify owner login before removing old credentials\n",
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
