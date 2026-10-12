import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { inspectInitialSetupDatabase } from "../deploy/scripts/server-setup-initial-host.mjs";

const roots: string[] = [];
const id = "a".repeat(48);
const identity = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
const pending = { id, kind: "initial", phase: "pending" } as const;
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(process.cwd(), ".initial-database-fixture-"));
  roots.push(root);
  await chmod(root, 0o700);
  const path = join(root, "database.sqlite3");
  await writeFile(path, "", { mode: 0o640 });
  await chmod(path, 0o640);
  return { root, path };
}
describe.skipIf(process.platform !== "linux")(
  "initial SQLite recovery is journal-owned and read-only",
  () => {
    it.each([0o640, 0o660])(
      "permits the exact pending empty DB with mode %s without modifying it",
      async (mode) => {
        const f = await fixture();
        await chmod(f.path, mode);
        const before = await lstat(f.path);
        expect(
          await inspectInitialSetupDatabase(f.path, id, identity, pending),
        ).toBe("none");
        const after = await lstat(f.path);
        expect(after.ino).toBe(before.ino);
        expect(after.size).toBe(0);
        expect(after.mtimeMs).toBe(before.mtimeMs);
        expect(after.mode).toBe(before.mode);
      },
    );
    it.each([
      null,
      { ...pending, id: "b".repeat(48) },
      { ...pending, kind: "ingress" as const },
      { ...pending, phase: "owner-ready" as const },
      { ...pending, phase: "committed" as const },
    ])(
      "refuses an empty DB without matching pending initial ownership %j",
      async (journal) => {
        const f = await fixture();
        await expect(
          inspectInitialSetupDatabase(f.path, id, identity, journal),
        ).rejects.toThrow("matching pending transaction");
        expect((await lstat(f.path)).size).toBe(0);
      },
    );
    it.each(["-wal", "-shm", "-journal"])(
      "refuses even an empty %s sidecar without removing it",
      async (suffix) => {
        const f = await fixture();
        const sidecar = `${f.path}${suffix}`;
        await writeFile(sidecar, "");
        await expect(
          inspectInitialSetupDatabase(f.path, id, identity, pending),
        ).rejects.toThrow("sidecar");
        expect((await lstat(sidecar)).size).toBe(0);
      },
    );
    it.each([0o600, 0o644, 0o666, 0o2640])(
      "refuses unexpected or unsafe mode %s",
      async (mode) => {
        const f = await fixture();
        await chmod(f.path, mode);
        await expect(
          inspectInitialSetupDatabase(f.path, id, identity, pending),
        ).rejects.toThrow("unsafe");
      },
    );
    it.each(["uid", "gid"] as const)(
      "refuses a different expected %s without chown",
      async (field) => {
        const f = await fixture();
        await expect(
          inspectInitialSetupDatabase(
            f.path,
            id,
            { ...identity, [field]: identity[field] + 1 },
            pending,
          ),
        ).rejects.toThrow("unsafe");
      },
    );
    it.each(["symlink", "hardlink", "directory", "parent-alias"])(
      "rejects %s without changing the target",
      async (kind) => {
        const f = await fixture();
        let candidate = join(f.root, "candidate");
        if (kind === "symlink") await symlink(f.path, candidate);
        if (kind === "hardlink") await link(f.path, candidate);
        if (kind === "directory") await mkdir(candidate);
        if (kind === "parent-alias") {
          await symlink(f.root, candidate);
          candidate = join(candidate, "database.sqlite3");
        }
        await expect(
          inspectInitialSetupDatabase(candidate, id, identity, pending),
        ).rejects.toThrow("unsafe");
        expect((await lstat(f.path)).size).toBe(0);
      },
    );
    it("rejects unmarked nonempty SQLite instead of treating it as an empty recoverable file", async () => {
      const f = await fixture();
      const db = new DatabaseSync(f.path);
      db.exec(
        "CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('keep');",
      );
      db.close();
      const before = await readFile(f.path);
      expect(
        await inspectInitialSetupDatabase(f.path, id, identity, pending),
      ).toBe("foreign");
      expect(await readFile(f.path)).toEqual(before);
    });
    it("preserves durable marker/owner/audit proof and recognizes an interrupted pre-schema bootstrap", async () => {
      const f = await fixture();
      const db = new DatabaseSync(f.path);
      db.exec("CREATE TABLE server_setup_bootstrap (id TEXT PRIMARY KEY);");
      db.prepare("INSERT INTO server_setup_bootstrap VALUES (?)").run(id);
      expect(
        await inspectInitialSetupDatabase(f.path, id, identity, pending),
      ).toBe("none");
      db.exec(
        "CREATE TABLE users (id TEXT, role TEXT); CREATE TABLE audit_logs (actor_id TEXT, action TEXT, result TEXT, target_id TEXT);",
      );
      db.exec("INSERT INTO users VALUES ('owner', 'owner');");
      expect(
        await inspectInitialSetupDatabase(f.path, id, identity, pending),
      ).toBe("foreign");
      db.prepare(
        "INSERT INTO audit_logs VALUES (?, 'user.created', 'success', 'owner')",
      ).run(`server-setup:${id}`);
      db.close();
      const before = await readFile(f.path);
      expect(
        await inspectInitialSetupDatabase(f.path, id, identity, {
          ...pending,
          phase: "owner-ready",
        }),
      ).toBe("ours");
      expect(
        await inspectInitialSetupDatabase(
          f.path,
          "b".repeat(48),
          identity,
          pending,
        ),
      ).toBe("foreign");
      expect(await readFile(f.path)).toEqual(before);
    });
  },
);
