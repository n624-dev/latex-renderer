#!/usr/bin/env node
import { isMainModule } from "./is-main-module.mjs";
// Fixed child of the privileged prepared-host adapter. All credentials arrive
// through a bounded anonymous pipe, not argv, env, logs or a shared temp file.

export async function createSetupOwner(input, options = {}) {
  if (
    !input ||
    Object.keys(input).sort().join() !== "databasePath,id,owner,pepper,review"
  )
    throw new Error("Invalid setup owner request");
  const { validateServerSetupReview, serverSetupInitialOwnerPlan } =
    await import("../../packages/server-setup-core/src/index.mjs");
  const review = validateServerSetupReview(input.review);
  if (
    input.databasePath !==
      (options.databasePath ?? "/var/lib/latex-renderer/renderer.sqlite3") ||
    review.runtime.databasePath !== input.databasePath ||
    !/^[a-f0-9]{48}$/.test(input.id)
  )
    throw new Error("Invalid setup owner database");
  const { RendererDatabase } =
    await import("../../packages/database/dist/index.js");
  const { bootstrapInitialOwner } =
    await import("../../packages/auth/dist/bootstrap-owner.js");
  const db = new RendererDatabase(input.databasePath);
  const pepper = Buffer.from(input.pepper, "base64");
  try {
    // This marker and owner audit are both durable identities, not PID/mtime
    // guesses. It makes a interrupted migration attributable to its journal.
    db.raw.exec(
      "CREATE TABLE IF NOT EXISTS server_setup_bootstrap (id TEXT PRIMARY KEY)",
    );
    const markers = db.raw
      .prepare("SELECT id FROM server_setup_bootstrap")
      .all();
    if (markers.length && (markers.length !== 1 || markers[0].id !== input.id))
      throw new Error("Foreign initial database marker");
    db.raw
      .prepare("INSERT OR IGNORE INTO server_setup_bootstrap(id) VALUES (?)")
      .run(input.id);
    db.migrate();
    const method = serverSetupInitialOwnerPlan(
      review.deployment.authentication,
    ).bootstrapMethod;
    const auth = review.deployment.authentication.authentication;
    const owner = {
      ...input.owner,
      method,
      ...(method === "password"
        ? { passwordPepper: pepper }
        : {
            issuer:
              auth.backend === "cloudflare-access"
                ? auth.issuer
                : auth.oidc.issuer,
          }),
    };
    if (method === "password" && pepper.length !== 32)
      throw new Error("Invalid password pepper");
    await bootstrapInitialOwner(db, owner, `server-setup:${input.id}`);
    db.raw.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    pepper.fill(0);
    input.owner.password = undefined;
    db.close();
  }
}
async function main() {
  process.umask(0o007);
  let length = 0;
  const chunks = [];
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 32 * 1024) throw new Error("Owner request too large");
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  try {
    await createSetupOwner(JSON.parse(bytes.toString("utf8")));
  } finally {
    bytes.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}
if (isMainModule(import.meta.url))
  main().catch(() => {
    process.stderr.write(
      "Initial owner provisioning failed; recover private setup state.\n",
    );
    process.exitCode = 1;
  });
