import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  chmod,
  symlink,
  link,
  stat,
} from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RendererDatabase } from "@latex-renderer/database";
import {
  createBrowserAuthenticationFromEnvironment,
  SESSION_COOKIE,
} from "@latex-renderer/auth";
import { createHash } from "node:crypto";
import { acquireMutationLockForPath } from "../deploy/scripts/mutation-lock.mjs";
import {
  importServerSetupAuthenticationReview,
  parseEnvironmentFile,
  productionAuthenticationPlan,
} from "../packages/server-setup-core/src/index.mjs";
import {
  AuthenticationChangeStore,
  authenticationChangeReview,
  authenticationUnits,
  applyAuthenticationChange,
  recoverAuthenticationChange,
  type AuthenticationChangeHost,
} from "../deploy/scripts/authentication-change.mjs";
import { requireAuthenticationOwner } from "../deploy/scripts/configure-authentication.mjs";

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true });
});
const before = [
  "# keep operator annotations",
  "DEPLOYMENT_MODE=standalone",
  "AUTH_MODE=password",
  "PUBLIC_ORIGIN=https://renderer.example.test",
  "RENDERER_PUBLIC_URL=https://renderer.example.test",
  "OIDC_ISSUER=https://id.example.test/tenant",
  "OIDC_CLIENT_ID=fixture-client",
  "STORAGE_ROOT=/private/storage",
  "SECRET_MARKER=never-export-private-value",
  "API_KEY_PEPPER_FILE=/private/pepper",
  "",
].join("\n");
const review = importServerSetupAuthenticationReview(
  before.replace(
    "AUTH_MODE=password",
    "AUTH_BACKEND=native\nAUTH_PASSWORD_ENABLED=true\nAUTH_OIDC_ENABLED=true\nOIDC_DISPLAY_NAME=School Account",
  ),
);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "authentication-change-"));
  directories.push(directory);
  await chmod(directory, 0o700);
  const environmentPath = join(directory, "renderer.env"),
    root = join(directory, "state");
  await writeFile(environmentPath, before, { mode: 0o640 });
  await chmod(environmentPath, 0o640);
  const store = new AuthenticationChangeStore(
    environmentPath,
    root,
    process.getuid?.() ?? 0,
    process.getgid?.() ?? 0,
  );
  const active = new Set<string>(authenticationUnits),
    events: string[] = [];
  const host: AuthenticationChangeHost = {
    active: (unit) => active.has(unit),
    run: (action, unit) => {
      events.push(`${action}:${unit}`);
      if (action === "stop") active.delete(unit);
      else active.add(unit);
    },
    preflight: (contents) => {
      productionAuthenticationPlan(parseEnvironmentFile(contents));
      events.push("preflight");
    },
    health: async (contents) => {
      expect(await store.environment()).toBe(contents);
      events.push("health");
    },
  };
  return {
    directory,
    environmentPath,
    root,
    store,
    host,
    active,
    events,
    ...authenticationChangeReview(before, review),
  };
}

describe("reviewed authentication transaction", () => {
  it("shares the same exclusive mutation lock and releases it for subsequent operations", async () => {
    const f = await fixture();
    const path = join(f.directory, "mutation.lock");
    const first = await acquireMutationLockForPath(path);
    try {
      await expect(acquireMutationLockForPath(path)).rejects.toMatchObject({
        code: "MUTATION_LOCK_BUSY",
      });
      await applyAuthenticationChange(f.store, f.host, f.envelope);
    } finally {
      await first.release();
    }
    const second = await acquireMutationLockForPath(path);
    await second.release();
    await second.release();
  });
  it("rollback restores configuration but never revives a cookie durably retired by real runtime startup", async () => {
    const f = await fixture();
    const database = new RendererDatabase(":memory:");
    database.migrate();
    const now = new Date().toISOString();
    const token = "synthetic-unused-password-cookie",
      hash = createHash("sha256").update(token).digest("hex");
    try {
      database.users.insertInvitation({
        id: "user_owner",
        displayName: "Owner",
        role: "owner",
        createdBy: "fixture",
        timestamp: now,
      });
      database.browserAuth.insertSession({
        token_hash: hash,
        user_id: "user_owner",
        auth_mode: "password",
        identity_id: null,
        user_security_version: 1,
        csrf_hash: "a".repeat(64),
        created_at: now,
        last_seen_at: now,
        idle_expires_at: new Date(Date.now() + 60_000).toISOString(),
        absolute_expires_at: new Date(Date.now() + 120_000).toISOString(),
        revoked_at: null,
      });
      await writeFile(
        join(f.directory, "auth-password-pepper"),
        Buffer.alloc(32, 7),
        { mode: 0o600 },
      );
      await writeFile(
        join(f.directory, "oidc-client-secret"),
        "synthetic-client-secret",
        { mode: 0o600 },
      );
      const target = importServerSetupAuthenticationReview(
        before.replace(
          "AUTH_MODE=password",
          "AUTH_BACKEND=native\nAUTH_PASSWORD_ENABLED=false\nAUTH_OIDC_ENABLED=true",
        ),
      );
      const prepared = authenticationChangeReview(before, target);
      f.host.health = (contents) => {
        createBrowserAuthenticationFromEnvironment(database, undefined, {
          ...Object.fromEntries(parseEnvironmentFile(contents)),
          CREDENTIALS_DIRECTORY: f.directory,
        });
        if (contents !== before)
          throw new Error("fixture candidate unhealthy AFTER retirement");
      };
      await expect(
        applyAuthenticationChange(f.store, f.host, prepared.envelope),
      ).rejects.toThrow(/recovery completed/);
      expect(await f.store.environment()).toBe(before);
      expect(database.browserAuth.getSession(hash)?.revoked_at).not.toBeNull();
      const auth = createBrowserAuthenticationFromEnvironment(
        database,
        undefined,
        {
          ...Object.fromEntries(parseEnvironmentFile(before)),
          CREDENTIALS_DIRECTORY: f.directory,
        },
      ).browserAuth;
      expect(
        auth.authenticateSession(
          new Request("https://renderer.example.test", {
            headers: { Cookie: `${SESSION_COOKIE}=${token}` },
          }),
        ),
      ).toBeUndefined();
      expect(database.users.get("user_owner")?.security_version).toBe(1);
    } finally {
      database.close();
    }
  });
  it("merges only auth keys, preserves private/unrelated lines, and exports only metadata/hashes", () => {
    const prepared = authenticationChangeReview(before, review);
    expect(prepared.after).toContain(
      "SECRET_MARKER=never-export-private-value",
    );
    expect(prepared.after).toContain("# keep operator annotations");
    expect(prepared.after).toContain("API_KEY_PEPPER_FILE=/private/pepper");
    expect(prepared.after).not.toContain("AUTH_MODE=");
    expect(JSON.stringify(prepared.envelope)).not.toMatch(
      /never-export|private\/|SECRET_MARKER|API_KEY_PEPPER/,
    );
    expect(
      productionAuthenticationPlan(parseEnvironmentFile(prepared.after)),
    ).toMatchObject({
      authMode: "native",
      passwordEnabled: true,
      oidcEnabled: true,
    });
  });
  it("requires an unchanged deployment/origin and unambiguous EnvironmentFile values", () => {
    for (const contents of [
      before.replace("standalone", "cloudflare"),
      before.replaceAll("renderer.example.test", "other.example.test"),
    ])
      expect(() => authenticationChangeReview(contents, review)).toThrow(
        /deployment or origin/,
      );
    expect(() =>
      authenticationChangeReview(before, {
        ...review,
        authentication: {
          ...review.authentication,
          oidc: {
            issuer: "https://id.example.test/tenant",
            clientId: "fixture-client",
            displayName: 'My "School"',
          },
        },
      }),
    ).toThrow(/quoting/);
  });
  it("durably journals before any stop, stops both before publication, starts both before commit, then clears", async () => {
    const f = await fixture();
    const run = f.host.run;
    f.host.run = async (action, unit) => {
      expect((await f.store.journal())?.phase).toBe("pending");
      if (action === "stop") expect(await f.store.environment()).toBe(before);
      else {
        expect(
          f.events.filter((event) => event.startsWith("stop:")),
        ).toHaveLength(2);
        expect(await f.store.environment()).toBe(f.after);
      }
      await run(action, unit);
    };
    expect(
      await applyAuthenticationChange(f.store, f.host, f.envelope),
    ).toMatchObject({ authMode: "native" });
    expect(await f.store.environment()).toBe(f.after);
    expect(await f.store.journal()).toBeNull();
    expect(f.active.size).toBe(2);
    expect((await stat(f.environmentPath)).mode & 0o777).toBe(0o640);
  });
  it.each(["base", "candidate", "review", "extra"])(
    "rejects stale/edited %s before stops or publication",
    async (kind) => {
      const f = await fixture();
      const envelope = {
        ...f.envelope,
        ...(kind === "base" ? { baseSha256: "a".repeat(64) } : {}),
        ...(kind === "candidate" ? { candidateSha256: "b".repeat(64) } : {}),
        ...(kind === "review"
          ? { review: importServerSetupAuthenticationReview(before) }
          : {}),
        ...(kind === "extra" ? { arbitraryCommand: "forbidden" } : {}),
      };
      await expect(
        applyAuthenticationChange(f.store, f.host, envelope),
      ).rejects.toThrow();
      expect(f.events).toEqual([]);
      expect(await f.store.environment()).toBe(before);
    },
  );
  it.each(["secret", "owner", "inactive", "pre-health"])(
    "%s preflight failure leaves running configuration unchanged",
    async (kind) => {
      const f = await fixture();
      if (kind === "inactive") f.active.delete(authenticationUnits[1]);
      else if (kind === "pre-health")
        f.host.health = () => {
          throw new Error("Private response must not propagate");
        };
      else
        f.host.preflight = () => {
          throw new Error("Missing required credential/owner");
        };
      await expect(
        applyAuthenticationChange(f.store, f.host, f.envelope),
      ).rejects.toThrow();
      expect(f.events.some((event) => event.startsWith("stop:"))).toBe(false);
      expect(await f.store.journal()).toBeNull();
      expect(await f.store.environment()).toBe(before);
    },
  );
  it.each(["stop", "publish", "start", "health"])(
    "recovers old configuration after %s failure",
    async (kind) => {
      const f = await fixture();
      let injected = false;
      const run = f.host.run,
        publish = f.store.replaceEnvironment.bind(f.store);
      f.host.run = async (action, unit) => {
        if (!injected && action === kind) {
          injected = true;
          throw new Error("synthetic service failure");
        }
        await run(action, unit);
      };
      if (kind === "publish")
        vi.spyOn(f.store, "replaceEnvironment").mockImplementation(
          async (contents) => {
            if (!injected) {
              injected = true;
              throw Object.assign(new Error("ENOSPC fixture"), {
                code: "ENOSPC",
              });
            }
            await publish(contents);
          },
        );
      if (kind === "health")
        f.host.health = (contents) => {
          if (contents !== before) throw new Error("unhealthy candidate");
        };
      await expect(
        applyAuthenticationChange(f.store, f.host, f.envelope),
      ).rejects.toThrow(/recovery completed/);
      expect(await f.store.environment()).toBe(before);
      expect(await f.store.journal()).toBeNull();
      expect(f.active.size).toBe(2);
    },
  );
  it("retains private recovery authority and fails closed when rollback cannot start a consumer", async () => {
    const f = await fixture();
    f.host.run = (action, unit) => {
      if (action === "stop") f.active.delete(unit);
      else throw new Error("private failed service response");
    };
    await expect(
      applyAuthenticationChange(f.store, f.host, f.envelope),
    ).rejects.toThrow(/recovery incomplete/);
    expect(await f.store.environment()).toBe(before);
    expect((await f.store.journal())?.phase).toBe("pending");
    await expect(
      applyAuthenticationChange(f.store, f.host, f.envelope),
    ).rejects.toThrow(/recover the previous/);
    expect((await stat(join(f.root, "journal.json"))).mode & 0o777).toBe(0o600);
  });
  it.each(["before", "after"])(
    "boot recovery of uncommitted %s publication restores config without starting services",
    async (phase) => {
      const f = await fixture();
      await f.store.initialize();
      await f.store.saveJournal({
        format: 1,
        phase: "pending",
        before,
        after: f.after,
      });
      if (phase === "after") await f.store.replaceEnvironment(f.after);
      f.active.clear();
      f.events.length = 0;
      const reopened = new AuthenticationChangeStore(
        f.environmentPath,
        f.root,
        f.store.uid,
        f.store.gid,
      );
      expect(await recoverAuthenticationChange(reopened, f.host, true)).toBe(
        true,
      );
      expect(await reopened.environment()).toBe(before);
      expect(f.events).toEqual([]);
      expect(await reopened.journal()).toBeNull();
      expect(await recoverAuthenticationChange(reopened, f.host, true)).toBe(
        false,
      );
    },
  );
  it("boot recovery never modifies a running consumer's configuration", async () => {
    const f = await fixture();
    await f.store.initialize();
    await f.store.saveJournal({
      format: 1,
      phase: "pending",
      before,
      after: f.after,
    });
    await f.store.replaceEnvironment(f.after);
    await expect(
      recoverAuthenticationChange(f.store, f.host, true),
    ).rejects.toThrow(/stopped consumers/);
    expect(await f.store.environment()).toBe(f.after);
    expect(await f.store.journal()).not.toBeNull();
  });
  it("keeps durable committed configuration if interrupted during cleanup", async () => {
    const f = await fixture();
    vi.spyOn(f.store, "clear").mockRejectedValueOnce(
      new Error("fixture unlink interrupted"),
    );
    await expect(
      applyAuthenticationChange(f.store, f.host, f.envelope),
    ).rejects.toThrow();
    expect((await f.store.journal())?.phase).toBe("committed");
    f.events.length = 0;
    await recoverAuthenticationChange(f.store, f.host);
    expect(await f.store.environment()).toBe(f.after);
    expect(f.events).toEqual([]);
  });
  it("does not overwrite out-of-transaction operator edits or a corrupt journal", async () => {
    const f = await fixture();
    await f.store.initialize();
    await f.store.saveJournal({
      format: 1,
      phase: "pending",
      before,
      after: f.after,
    });
    await writeFile(f.environmentPath, before + "EXTERNAL_EDIT=yes\n");
    await expect(recoverAuthenticationChange(f.store, f.host)).rejects.toThrow(
      /outside the transaction/,
    );
    expect(await f.store.environment()).toContain("EXTERNAL_EDIT");
    expect(f.events).toEqual([]);
    await writeFile(join(f.root, "journal.json"), '{"format":999}');
    await expect(
      recoverAuthenticationChange(f.store, f.host),
    ).rejects.toThrow();
    expect(f.events).toEqual([]);
  });
  it.each(["symlink", "hardlink", "mode", "directory"])(
    "rejects unsafe %s state without modifying external data",
    async (kind) => {
      const f = await fixture();
      await f.store.initialize();
      const external = join(f.directory, "external");
      await writeFile(external, "untouched", { mode: 0o600 });
      if (kind === "directory") {
        await rm(f.root, { recursive: true });
        await symlink(f.directory, f.root);
      } else if (kind === "symlink")
        await symlink(external, join(f.root, "journal.json"));
      else if (kind === "hardlink")
        await link(external, join(f.root, "journal.json"));
      else await chmod(f.environmentPath, 0o666);
      await expect(
        applyAuthenticationChange(f.store, f.host, f.envelope),
      ).rejects.toThrow();
      expect(await readFile(external, "utf8")).toBe("untouched");
      expect(f.events).toEqual([]);
    },
  );
  it("collects empty private interrupted temporaries without treating them as published config", async () => {
    const f = await fixture();
    await f.store.initialize();
    await writeFile(join(f.root, ".journal.tmp"), "", { mode: 0o600 });
    await writeFile(join(f.directory, ".authentication-env.tmp"), "", {
      mode: 0o640,
    });
    await chmod(join(f.directory, ".authentication-env.tmp"), 0o640);
    await f.store.initialize();
    expect(await f.store.environment()).toBe(before);
    await expect(stat(join(f.root, ".journal.tmp"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
  it("recovers an actual SIGKILL after atomic candidate publication using a reopened store", async () => {
    const f = await fixture();
    const moduleUrl = new URL(
      "../deploy/scripts/authentication-change.mjs",
      import.meta.url,
    ).href;
    const child = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import { AuthenticationChangeStore, authenticationChangeReview, applyAuthenticationChange } from ${JSON.stringify(moduleUrl)};
      const before = ${JSON.stringify(before)}, review = ${JSON.stringify(review)};
      const store = new AuthenticationChangeStore(${JSON.stringify(f.environmentPath)}, ${JSON.stringify(f.root)}, process.getuid(), process.getgid());
      const active = new Set(['latex-renderer-admin-api.service','latex-renderer-remote-mcp.service']);
      await applyAuthenticationChange(store, {
        active: unit => active.has(unit), preflight: () => {},
        run: (action,unit) => action === 'stop' ? active.delete(unit) : active.add(unit),
        health: text => { if(text !== before) process.kill(process.pid, 'SIGKILL'); }
      }, authenticationChangeReview(before, review).envelope);
    `,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    expect(child.signal).toBe("SIGKILL");
    expect(await f.store.environment()).toBe(f.after);
    f.active.clear();
    await recoverAuthenticationChange(f.store, f.host, true);
    expect(await f.store.environment()).toBe(before);
    expect(await f.store.journal()).toBeNull();
  });
});

describe("read-only cutover owner guard", () => {
  it("requires an active explicitly provisioned owner; never links email or repairs the DB", () => {
    const database = new RendererDatabase(":memory:");
    database.migrate();
    try {
      const plan = productionAuthenticationPlan(
        parseEnvironmentFile(authenticationChangeReview(before, review).after),
      );
      expect(() => requireAuthenticationOwner(database.raw, plan)).toThrow(
        /active owner/,
      );
      database.users.insertInvitation({
        id: "user_owner",
        displayName: "Owner",
        role: "owner",
        email: "same@example.test",
        createdBy: "fixture",
        timestamp: new Date().toISOString(),
      });
      expect(() => requireAuthenticationOwner(database.raw, plan)).toThrow();
      database.browserAuth.upsertCredential({
        user_id: "user_owner",
        login_name: "owner",
        password_hash: "x".repeat(80),
        password_updated_at: new Date().toISOString(),
      });
      expect(() =>
        requireAuthenticationOwner(database.raw, plan),
      ).not.toThrow();
      database.raw.exec("UPDATE users SET status='disabled'");
      expect(() => requireAuthenticationOwner(database.raw, plan)).toThrow();
      expect(database.browserAuth.identitiesForUser("user_owner")).toEqual([]);
    } finally {
      database.close();
    }
  });
  it("orders boot recovery before both consumers and exposes no privileged command through sudoers", async () => {
    for (const name of ["admin-api", "remote-mcp"]) {
      const unit = await readFile(
        new URL(
          `../deploy/systemd/latex-renderer-${name}.service`,
          import.meta.url,
        ),
        "utf8",
      );
      expect(unit).toContain(
        "Requires=latex-renderer-authentication-recovery.service",
      );
      expect(unit).toContain(
        "After=latex-renderer-authentication-recovery.service",
      );
    }
    const sudoers = await readFile(
      new URL("../deploy/sudoers.d/latex-renderer-update", import.meta.url),
      "utf8",
    );
    expect(sudoers).not.toContain("configure-authentication");
  });
});
