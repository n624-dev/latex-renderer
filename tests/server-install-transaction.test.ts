import {
  mkdtemp,
  chmod,
  rm,
  writeFile,
  readFile,
  lstat,
  symlink,
  link,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServerInstallStore } from "../deploy/scripts/server-install-store.mjs";
import {
  applyInstallation,
  recoverInstallation,
  reviewInstallation,
  validateInstallationJournal,
  type InstallationHost,
} from "../deploy/scripts/server-install-transaction.mjs";
import {
  importServerSetupReview,
  validateServerInitialInput,
  validateServerIngressInput,
  createServerSetupSession,
  type ServerSetupReview,
} from "../packages/server-setup-core/src/index.mjs";
import { createSetupOwner } from "../deploy/scripts/server-setup-owner.mjs";
import { runServerInitialCui } from "../deploy/scripts/server-setup-initial-cui.mjs";
import { ingressTlsFixture } from "./fixtures/server-ingress.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});
function model(): ServerSetupReview {
  return importServerSetupReview(
    [
      "DEPLOYMENT_MODE=standalone",
      "AUTH_MODE=password",
      "PUBLIC_ORIGIN=https://localhost",
      "RENDERER_PUBLIC_URL=https://localhost",
      "INGRESS_ACCESS_SCOPE=local",
      "INGRESS_TLS_PROVIDER=custom",
      "INGRESS_LISTEN_ADDRESS=127.0.0.1",
      "DATABASE_PATH=/var/lib/latex-renderer/renderer.sqlite3",
      "STORAGE_ROOT=/var/lib/latex-renderer/storage",
      `RENDERER_IMAGE=sha256:${"a".repeat(64)}`,
      "",
    ].join("\n"),
  );
}
async function fixture(kind: "initial" | "ingress" = "initial") {
  const root = await mkdtemp(join(process.cwd(), ".server-install-fixture-"));
  roots.push(root);
  await chmod(root, 0o700);
  const uid = process.getuid?.() ?? 0,
    gid = process.getgid?.() ?? 0;
  const slots = Object.fromEntries(
    ["environment", "certificate", "privateKey", "nginx", "oidcSecret"].map(
      (name) => [
        name,
        { path: join(root, name), mode: 0o600, maximum: 600 * 1024, gid },
      ],
    ),
  );
  const store = new ServerInstallStore(root, slots, uid);
  let owner: "none" | "ours" | "foreign" = kind === "initial" ? "none" : "ours";
  const active = new Set<string>();
  const host: InstallationHost = {
    kind,
    preflight: vi.fn(),
    validateCredentials: vi.fn(),
    files: vi.fn(() => ({
      environment: "new-environment",
      certificate: "new-cert",
      privateKey: "new-key",
      nginx: "new-nginx",
      oidcSecret: null,
    })),
    units: () => [
      "latex-renderer-api.service",
      "latex-renderer-worker.service",
    ],
    active: (unit) => active.has(unit),
    stop: vi.fn((unit: string) => {
      active.delete(unit);
    }),
    start: vi.fn((unit: string) => {
      active.add(unit);
    }),
    ownerState: () => owner,
    ensureSecrets: vi.fn(),
    createOwner: vi.fn(() => {
      owner = "ours";
    }),
    validatePublished: vi.fn(),
    health: vi.fn(),
  };
  if (kind === "ingress")
    await store.replace({
      environment: "old-environment",
      certificate: "old-cert",
      privateKey: "old-key",
      nginx: "old-nginx",
      oidcSecret: null,
    });
  return {
    root,
    store,
    host,
    active,
    setOwner: (state: typeof owner) => {
      owner = state;
    },
  };
}

describe("durable prepared-host installation", () => {
  it("enables persistent services only after durable commit and retries finalization without owner reset", async () => {
    const f = await fixture();
    f.host.finalize = vi.fn(async () => {
      expect((await f.store.journal())?.phase).toBe("committed");
      throw new Error("enable interrupted");
    });
    await expect(
      applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      ),
    ).rejects.toThrow("RECOVERY_REQUIRED");
    expect((await f.store.journal())?.phase).toBe("committed");
    f.host.finalize = vi.fn();
    expect(await recoverInstallation(f.store, f.host)).toMatchObject({
      committed: true,
    });
    expect(f.host.createOwner).toHaveBeenCalledOnce();
    expect(f.host.finalize).toHaveBeenCalledOnce();
  });
  it("recovers an owner commit before its file-journal phase was saved", async () => {
    const f = await fixture();
    f.host.createOwner = vi.fn(() => {
      f.setOwner("ours");
      throw new Error("killed after SQLite commit");
    });
    await expect(
      applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      ),
    ).rejects.toThrow();
    expect((await f.store.journal())?.phase).toBe("pending");
    expect(await recoverInstallation(f.store, f.host)).toMatchObject({
      committed: true,
    });
    expect(f.host.createOwner).toHaveBeenCalledOnce();
  });
  it("retains recoverable state on ENOSPC in the middle of file publication", async () => {
    const f = await fixture(),
      write = f.store.write.bind(f.store);
    f.store.write = async (slot, contents) => {
      if (slot.path === f.store.slot("privateKey").path)
        throw Object.assign(new Error("full"), { code: "ENOSPC" });
      await write(slot, contents);
    };
    await expect(
      applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      ),
    ).rejects.toThrow("RECOVERY_REQUIRED");
    expect((await f.store.journal())?.phase).toBe("owner-ready");
    expect(f.host.health).not.toHaveBeenCalled();
    expect(f.active.size).toBe(0);
    f.store.write = write;
    expect(await recoverInstallation(f.store, f.host)).toMatchObject({
      committed: true,
    });
    expect(f.host.createOwner).toHaveBeenCalledOnce();
  });
  it("does not clear rollback recovery state if restored consumers cannot start", async () => {
    const f = await fixture("ingress");
    f.host.start = vi.fn();
    await expect(
      applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      ),
    ).rejects.toThrow("RECOVERY_REQUIRED");
    expect(await f.store.journal()).not.toBeNull();
    expect(f.host.createOwner).not.toHaveBeenCalled();
    expect(f.host.ensureSecrets).not.toHaveBeenCalled();
    f.host.start = (unit) => {
      f.active.add(unit);
    };
    expect(await recoverInstallation(f.store, f.host)).toMatchObject({
      rolledBack: true,
    });
  });
  it("restricts maintenance activation to known fixed timers and managers", () => {
    const journal = {
      format: 1,
      kind: "initial",
      id: "c".repeat(48),
      phase: "pending",
      before: {},
      after: {},
      units: [
        "latex-renderer-backup.timer",
        "latex-renderer-update-manager.service",
      ],
    };
    expect(validateInstallationJournal(journal).units).toEqual(journal.units);
    expect(() =>
      validateInstallationJournal({ ...journal, units: ["nginx.service"] }),
    ).toThrow();
    expect(() =>
      validateInstallationJournal({
        ...journal,
        units: ["texlive-ci-gc.timer"],
      }),
    ).toThrow();
  });
  it("reviews without keys, owner, configuration or services mutation", async () => {
    const f = await fixture();
    const review = await reviewInstallation(f.store, f.host, model());
    expect(review.baseSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(await f.store.journal()).toBeNull();
    expect(f.host.createOwner).not.toHaveBeenCalled();
    expect(f.host.ensureSecrets).not.toHaveBeenCalled();
    expect(f.host.stop).not.toHaveBeenCalled();
  });
  it("journals before irreversible provisioning, publishes files and commits only after health", async () => {
    const f = await fixture();
    f.host.ensureSecrets = vi.fn(async () => {
      expect((await f.store.journal())?.phase).toBe("pending");
    });
    f.host.health = vi.fn(async () => {
      expect((await f.store.journal())?.phase).toBe("owner-ready");
    });
    await applyInstallation(
      f.store,
      f.host,
      await reviewInstallation(f.store, f.host, model()),
      { password: "not-in-journal" },
    );
    expect(await f.store.journal()).toBeNull();
    expect(await readFile(join(f.root, "environment"), "utf8")).toBe(
      "new-environment",
    );
    expect(f.active.size).toBe(2);
    expect(f.host.createOwner).toHaveBeenCalledOnce();
  });
  it("rejects stale review and bad credentials before provisioning", async () => {
    const f = await fixture(),
      envelope = await reviewInstallation(f.store, f.host, model());
    await f.store.write(f.store.slot("environment"), "concurrent change");
    await expect(
      applyInstallation(f.store, f.host, envelope, {}),
    ).rejects.toThrow("stale");
    expect(f.host.ensureSecrets).not.toHaveBeenCalled();
    const next = await reviewInstallation(f.store, f.host, model());
    f.host.validateCredentials = () => {
      throw new Error("bad credential");
    };
    await expect(applyInstallation(f.store, f.host, next, {})).rejects.toThrow(
      "bad credential",
    );
    expect(await f.store.journal()).toBeNull();
  });
  it.each(["ensureSecrets", "createOwner"] as const)(
    "recovers interruption before owner at %s without deleting a migrated DB or keys",
    async (step) => {
      const f = await fixture();
      f.host[step] = () => {
        throw new Error("interrupted");
      };
      await expect(
        applyInstallation(
          f.store,
          f.host,
          await reviewInstallation(f.store, f.host, model()),
          {},
        ),
      ).rejects.toThrow("RECOVERY_REQUIRED");
      const before = await f.store.journal();
      expect(JSON.stringify(before)).not.toContain("password");
      expect(await recoverInstallation(f.store, f.host)).toMatchObject({
        rolledBack: true,
        awaitingCredentials: true,
      });
      expect(await f.store.read(f.store.slot("environment"))).toBeNull();
      expect((await f.store.journal())?.id).toBe(before?.id);
      f.host.ensureSecrets = () => {};
      f.host.createOwner = () => {
        f.setOwner("ours");
      };
      await applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      );
      expect(await f.store.journal()).toBeNull();
    },
  );
  it.each(["validatePublished", "start", "health"] as const)(
    "recovers forward after owner interruption at %s, never creates/reset owner again",
    async (step) => {
      const f = await fixture();
      f.host[step] = () => {
        throw new Error("interrupted");
      };
      await expect(
        applyInstallation(
          f.store,
          f.host,
          await reviewInstallation(f.store, f.host, model()),
          {},
        ),
      ).rejects.toThrow("RECOVERY_REQUIRED");
      const restarted = new ServerInstallStore(
        f.root,
        Object.fromEntries(
          [
            "environment",
            "certificate",
            "privateKey",
            "nginx",
            "oidcSecret",
          ].map((name) => [name, f.store.slot(name)]),
        ),
        process.getuid?.() ?? 0,
      );
      f.host[step] = () => {};
      // start must report genuinely active state, not only a successful command.
      if (step === "start")
        f.host.start = (unit) => {
          f.active.add(unit);
        };
      expect(await recoverInstallation(restarted, f.host)).toMatchObject({
        committed: true,
      });
      expect(f.host.createOwner).toHaveBeenCalledOnce();
      expect(await restarted.journal()).toBeNull();
    },
  );
  it("boot recovery publishes owner-ready files but keeps journal until foreground health is verified", async () => {
    const f = await fixture();
    f.host.health = () => {
      throw new Error("unhealthy");
    };
    await expect(
      applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      ),
    ).rejects.toThrow();
    f.active.clear();
    expect(await recoverInstallation(f.store, f.host, true)).toMatchObject({
      pendingHealth: true,
    });
    expect(await f.store.journal()).not.toBeNull();
    f.host.health = () => {};
    await recoverInstallation(f.store, f.host);
    expect(await f.store.journal()).toBeNull();
  });
  it("fails closed on a foreign owner or file edits; retains recovery state", async () => {
    const f = await fixture();
    f.host.health = () => {
      throw new Error();
    };
    await expect(
      applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      ),
    ).rejects.toThrow();
    f.setOwner("foreign");
    await expect(recoverInstallation(f.store, f.host)).rejects.toThrow("owner");
    f.setOwner("ours");
    await f.store.write(f.store.slot("nginx"), "operator edits");
    await expect(recoverInstallation(f.store, f.host)).rejects.toThrow(
      "outside transaction",
    );
    expect(await f.store.journal()).not.toBeNull();
  });
  it("does not restore an already committed old environment if journal cleanup was interrupted", async () => {
    const f = await fixture(),
      clear = f.store.clear.bind(f.store);
    f.store.clear = () => Promise.reject(new Error("crash"));
    await expect(
      applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      ),
    ).rejects.toThrow();
    expect((await f.store.journal())?.phase).toBe("committed");
    f.store.clear = clear;
    await recoverInstallation(f.store, f.host);
    expect(await f.store.read(f.store.slot("environment"))).toBe(
      "new-environment",
    );
  });
  it("rolls back all existing ingress files on health failure without touching owner or generated keys", async () => {
    const f = await fixture("ingress");
    f.host.health = vi
      .fn()
      .mockRejectedValueOnce(new Error("unhealthy"))
      .mockResolvedValue(undefined);
    await expect(
      applyInstallation(
        f.store,
        f.host,
        await reviewInstallation(f.store, f.host, model()),
        {},
      ),
    ).rejects.toThrow("PREVIOUS_CONFIGURATION_RESTORED");
    expect(await f.store.read(f.store.slot("environment"))).toBe(
      "old-environment",
    );
    expect(await f.store.read(f.store.slot("privateKey"))).toBe("old-key");
    expect(await f.store.journal()).toBeNull();
  });
  it("rejects malformed/corrupt state, unknown slots and arbitrary systemd units", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "journal.json"), "{broken", { mode: 0o600 });
    await expect(f.store.journal()).rejects.toThrow();
    expect(() =>
      validateInstallationJournal({
        format: 1,
        kind: "initial",
        phase: "pending",
        id: "a".repeat(48),
        before: {},
        after: {},
        units: ["sshd.service"],
      }),
    ).toThrow();
    await expect(f.store.snapshotFiles({ outside: "value" })).rejects.toThrow(
      "Unsupported",
    );
  });
  it("refuses symlinks and hardlinks without deleting outside targets", async () => {
    const f = await fixture(),
      other = join(f.root, "operator-file");
    await writeFile(other, "keep");
    await symlink(other, join(f.root, "environment"));
    await expect(
      f.store.write(f.store.slot("environment"), "new"),
    ).rejects.toThrow();
    await rm(join(f.root, "environment"));
    await chmod(other, 0o600);
    await link(other, join(f.root, "environment"));
    await expect(
      f.store.write(f.store.slot("environment"), null),
    ).rejects.toThrow();
    expect(await readFile(other, "utf8")).toBe("keep");
  });
});

describe("initial input and shared frontends", () => {
  it("validates TLS/owner without putting credentials in the non-secret review", () => {
    const tls = ingressTlsFixture();
    try {
      const review = model(),
        credentials = {
          owner: {
            displayName: "Owner",
            loginName: "owner",
            password: "long-not-common-passphrase",
          },
          tls: {
            certificate: tls.certificate.toString(),
            privateKey: tls.key.toString(),
          },
        };
      expect(
        validateServerInitialInput(review, credentials).owner.password,
      ).toBe(credentials.owner.password);
      expect(JSON.stringify(review)).not.toContain(credentials.owner.password);
      expect(() =>
        validateServerInitialInput(review, {
          ...credentials,
          oidcClientSecret: "wrong-stale-secret",
        }),
      ).toThrow("not enabled");
      expect(() =>
        validateServerInitialInput(review, {
          ...credentials,
          owner: { ...credentials.owner, subject: "do-not-link" },
        }),
      ).toThrow("implicitly");
      expect(() =>
        validateServerIngressInput(review, {
          tls: credentials.tls,
          owner: credentials.owner,
        }),
      ).toThrow();
    } finally {
      tls.cleanup();
    }
  });
  it("never evaluates a credentials getter and rejects oversized PEM/unsupported automatic HTTPS", () => {
    let accessed = false;
    const input = {
      get owner() {
        accessed = true;
        return {};
      },
    };
    expect(() => validateServerInitialInput(model(), input)).toThrow();
    expect(accessed).toBe(false);
    expect(() =>
      validateServerIngressInput(model(), {
        tls: { certificate: "a".repeat(512 * 1024 + 1), privateKey: "k" },
      }),
    ).toThrow("size");
    const review = model();
    expect(() =>
      validateServerIngressInput(
        {
          ...review,
          deployment: {
            ...review.deployment,
            ingress: { ...review.deployment.ingress, tlsProvider: "automatic" },
          },
        },
        { tls: { certificate: "x", privateKey: "y" } },
      ),
    ).toThrow("Custom");
  });
  it("supports explicit recovery in the same session and never leaks host errors", async () => {
    const session = createServerSetupSession({
      current: model,
      preview: (review) => ({ review }),
      apply: () => {
        throw new Error("secret-owner-password");
      },
      recover: () => ({ committed: true }),
    });
    const checked = await session.preview(model());
    await expect(session.apply(checked.confirmation)).rejects.toThrow(
      "RECOVERY_MAY_BE_REQUIRED",
    );
    expect(await session.recover()).toEqual({
      phase: "complete",
      awaitingCredentials: false,
    });
  });
  it("CUI initial setup collects secrets through hidden IO only and can cancel before mutation", async () => {
    const tls = ingressTlsFixture();
    try {
      const ask = vi
        .fn()
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce(JSON.stringify(model()))
        .mockResolvedValueOnce("Owner")
        .mockResolvedValueOnce("")
        .mockResolvedValueOnce("owner")
        .mockResolvedValueOnce("ubuntu")
        .mockResolvedValueOnce("cert.pem")
        .mockResolvedValueOnce("key.pem")
        .mockResolvedValueOnce("CANCEL");
      const askSecret = vi.fn().mockResolvedValue("long-not-common-passphrase"),
        print = vi.fn(),
        apply = vi.fn();
      expect(
        await runServerInitialCui(
          {
            scope: "initial-prepared-host",
            current: model,
            preview: (candidate) => ({ candidate }),
            apply,
          },
          {
            ask,
            askSecret,
            print,
            readFile: vi
              .fn()
              .mockResolvedValueOnce(tls.certificate.toString())
              .mockResolvedValueOnce(tls.key.toString()),
          },
        ),
      ).toEqual({ applied: false });
      expect(askSecret).toHaveBeenCalledTimes(2);
      expect(apply).not.toHaveBeenCalled();
      expect(JSON.stringify(print.mock.calls)).not.toContain(
        "long-not-common-passphrase",
      );
    } finally {
      tls.cleanup();
    }
  });
  it("actual owner provisioning records recoverable identity, migrates and refuses an owner reset", async () => {
    const f = await fixture(),
      databasePath = join(f.root, "owner.sqlite3"),
      review = model(),
      id = "b".repeat(48);
    const candidate = {
      ...review,
      runtime: { ...review.runtime, databasePath },
    };
    const request = () => ({
      databasePath,
      id,
      review: candidate,
      owner: {
        displayName: "Initial Owner",
        loginName: "owner",
        password: "long-not-common-passphrase",
      },
      pepper: Buffer.alloc(32, 1).toString("base64"),
    });
    await createSetupOwner(request(), { databasePath });
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try {
      expect(db.prepare("SELECT id FROM server_setup_bootstrap").get()).toEqual(
        { id },
      );
      expect(
        db
          .prepare(
            "SELECT actor_id FROM audit_logs WHERE action='user.created'",
          )
          .get(),
      ).toEqual({ actor_id: `server-setup:${id}` });
      const credential = db
        .prepare("SELECT password_hash FROM local_credentials")
        .get();
      expect(JSON.stringify(credential)).not.toContain(
        "long-not-common-passphrase",
      );
    } finally {
      db.close();
    }
    await expect(createSetupOwner(request(), { databasePath })).rejects.toThrow(
      "owner already exists",
    );
    expect((await lstat(databasePath)).isFile()).toBe(true);
  });
});
