import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  lstat,
  rm,
  symlink,
  rename,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync, statSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import {
  RecoveryStore,
  recoveryPolicy,
} from "../deploy/scripts/update-recovery.mjs";
import { withQuiescedRecovery } from "../deploy/scripts/update-recovery-host.mjs";

const roots: string[] = [];
const now = 1789430400000;
afterEach(async () => {
  for (const path of roots.splice(0))
    await rm(path, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "update-recovery-"));
  roots.push(root);
  const storage = join(root, "storage"),
    database = join(root, "db.sqlite3");
  await mkdir(join(storage, "jobs/result"), { recursive: true });
  await mkdir(join(storage, "empty"));
  await writeFile(join(storage, "jobs/result/output.pdf"), "PDF fixture");
  const db = new DatabaseSync(database);
  db.exec(
    "PRAGMA user_version=17; CREATE TABLE owner(id PRIMARY KEY); INSERT INTO owner VALUES('existing-owner');",
  );
  db.close();
  const identity = join(root, "identity"),
    recipient = join(root, "recipient");
  execFileSync("age-keygen", ["-o", identity], { stdio: "pipe" });
  await writeFile(recipient, execFileSync("age-keygen", ["-y", identity]), {
    mode: 0o600,
  });
  const store = new RecoveryStore(
    join(root, "managed"),
    recoveryPolicy({ maxBytes: 512 * 1024 ** 2, minFreeBytes: 0 }),
  );
  return {
    root,
    store,
    database,
    storage,
    identity,
    recipient,
    release: { version: "1.3.5", commit: "a".repeat(40) },
    now,
  };
}

it("encrypts and actually decrypt-verifies the DB, complete storage and empty directories", async () => {
  const f = await fixture(),
    point = await f.store.create(f);
  expect(point).toMatchObject({ storageIncluded: true, schema: 17, files: 2 });
  expect(await readdir(join(f.store.root, "staging"))).toEqual([]);
  expect(await readdir(join(f.store.root, "points", point.id))).toEqual([
    "recovery.tar.age",
    "summary.json",
  ]);
  const archive = join(f.store.root, "points", point.id, "recovery.tar.age");
  const tar = execFileSync("age", ["-d", "-i", f.identity, archive]);
  const listing = execFileSync("tar", ["-tf", "-"], {
    input: tar,
    encoding: "utf8",
  });
  expect(listing).toContain("./storage/empty/");
  expect(
    execFileSync("tar", ["-xOf", "-", "./storage/jobs/result/output.pdf"], {
      input: tar,
      encoding: "utf8",
    }),
  ).toBe("PDF fixture");
  expect((await lstat(archive)).mode & 0o777).toBe(0o600);
});
it("keeps two generations, expires after seven days, and leaves unrelated backups untouched", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "legacy-backup.age"), "keep");
  const first = await f.store.create(f);
  await f.store.create({ ...f, now: now + 1 });
  await f.store.create({ ...f, now: now + 2 });
  await f.store.collect({ now: now + 3 });
  expect((await f.store.points()).map((point) => point.id)).not.toContain(
    first.id,
  );
  expect(await f.store.points()).toHaveLength(2);
  await f.store.collect({ now: now + 8 * 24 * 3600_000 });
  expect(await f.store.points()).toEqual([]);
  expect(await readFile(join(f.root, "legacy-backup.age"), "utf8")).toBe(
    "keep",
  );
});
it("resumes an interrupted deletion without requiring completed metadata in trash", async () => {
  const f = await fixture(),
    point = await f.store.create(f);
  const trash = join(f.store.root, "trash", point.id);
  await rename(join(f.store.root, "points", point.id), trash);
  await rm(join(trash, "summary.json"));
  await f.store.collect({ now });
  expect(await readdir(join(f.store.root, "trash"))).toEqual([]);
  expect(await f.store.points()).toEqual([]);
  await expect(f.store.remove(f.storage)).rejects.toThrow(
    "Invalid recovery removal target",
  );
  await expect(f.store.discard("../../storage")).rejects.toThrow(
    "Invalid recovery point ID",
  );
});
it("blocks on working peak, not just tiny finished archive size", async () => {
  const f = await fixture();
  f.store.policy.maxBytes = 100 * 1024 ** 2;
  await expect(f.store.create(f)).rejects.toThrow("RECOVERY_CAPACITY_BLOCKED");
  expect(await readdir(join(f.store.root, "staging"))).toEqual([]);
  expect(await f.store.points()).toEqual([]);
});
it("includes committed WAL pages in admission even when the main DB file is small", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.database);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE pending(value BLOB); INSERT INTO pending VALUES(zeroblob(4194304));",
    );
    expect((await lstat(f.database)).size).toBeLessThan(1024 * 1024);
    f.store.policy.maxBytes = 200 * 1024 ** 2;
    await expect(f.store.create(f)).rejects.toThrow(
      "RECOVERY_CAPACITY_BLOCKED",
    );
    expect(await f.store.points()).toEqual([]);
  } finally {
    db.close();
  }
});
it("does not publish a point with the wrong decryption key and cleans plaintext staging", async () => {
  const f = await fixture(),
    other = join(f.root, "other-key");
  execFileSync("age-keygen", ["-o", other], { stdio: "pipe" });
  await expect(f.store.create({ ...f, identity: other })).rejects.toThrow();
  expect(await f.store.points()).toEqual([]);
  expect(await readdir(join(f.store.root, "staging"))).toEqual([]);
});
it("cleans a private incomplete SQLite destination after ENOSPC", async () => {
  const f = await fixture();
  // Keep the dynamic database receiver while intercepting only VACUUM below.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const prepare = DatabaseSync.prototype.prepare;
  const spy = vi
    .spyOn(DatabaseSync.prototype, "prepare")
    .mockImplementation(function (this: DatabaseSync, sql: string) {
      const statement = prepare.call(this, sql);
      if (sql === "VACUUM INTO ?")
        vi.spyOn(statement, "run").mockImplementation((path) => {
          if (typeof path !== "string")
            throw new Error("Invalid SQLite destination");
          expect(statSync(path).mode & 0o777).toBe(0o600);
          writeFileSync(path, "incomplete SQLite snapshot");
          throw new Error("ENOSPC");
        });
      return statement;
    });
  try {
    await expect(f.store.create(f)).rejects.toThrow("ENOSPC");
    expect(await f.store.points()).toEqual([]);
    expect(await readdir(join(f.store.root, "staging"))).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});
it("does not collect good backups when another archive is corrupt", async () => {
  const f = await fixture(),
    first = await f.store.create(f),
    second = await f.store.create({ ...f, now: now + 1 });
  const path = join(f.store.root, "points", second.id, "recovery.tar.age");
  const bytes = await readFile(path);
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  await writeFile(path, bytes);
  await expect(
    f.store.collect({ now: now + 8 * 24 * 3600_000 }),
  ).rejects.toThrow("Corrupt recovery archive");
  expect(await readdir(join(f.store.root, "points"))).toContain(first.id);
});
it("rejects storage links and managed cleanup links without following them", async () => {
  const f = await fixture();
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "keep"), "keep");
  await symlink(outside, join(f.storage, "escape"));
  await expect(f.store.create(f)).rejects.toThrow("Unsafe entry");
  await symlink(outside, join(f.store.root, "staging/work-abcdef"));
  await expect(f.store.collect()).rejects.toThrow("Unsafe entry");
  expect(await readFile(join(outside, "keep"), "utf8")).toBe("keep");
});
it("validates capacity and retention settings", () => {
  for (const config of [
    { maxBytes: 0 },
    { retainCount: 0 },
    { retainHours: NaN },
    { minFreeBytes: -1 },
    { maxBytes: 2 ** 50 },
  ])
    expect(() => recoveryPolicy(config)).toThrow();
  expect(recoveryPolicy().maxBytes).toBe(4 * 1024 ** 3);
});

async function quiescedFixture() {
  const f = await fixture();
  const enabled = new Set([
    "latex-renderer-api.service",
    "latex-renderer-worker.service",
    "latex-renderer-cleanup.timer",
  ]);
  const original = [...enabled],
    calls: string[][] = [];
  const owner = (pid = 123) =>
    Promise.resolve({
      pid,
      start: "123",
      boot: "fixture-boot",
    });
  const run = (...args: string[]) => {
    calls.push(args);
    if (!args[1]) throw new Error("Missing unit");
    if (args[0] === "stop") enabled.delete(args[1]);
    else enabled.add(args[1]);
  };
  const create = vi.fn(async () => {
    expect(enabled.size).toBe(0);
    return f.store.create(f);
  });
  return {
    ...f,
    enabled,
    original,
    calls,
    options: {
      store: f.store,
      create,
      inspect: (unit: string) => enabled.has(unit),
      run,
      owner,
    },
  };
}
it("quiesces writers through deployment, restores only original units, and removes the completed journal", async () => {
  const f = await quiescedFixture();
  await withQuiescedRecovery(f.options, () => {
    expect(f.enabled.size).toBe(0);
    return Promise.resolve();
  });
  expect([...f.enabled].sort()).toEqual(f.original.sort());
  expect(await readdir(f.store.root)).not.toContain("operation.json");
});
it("restores services without deploying when point creation fails", async () => {
  const f = await quiescedFixture(),
    action = vi.fn();
  f.options.create.mockRejectedValueOnce(new Error("ENOSPC"));
  await expect(withQuiescedRecovery(f.options, action)).rejects.toThrow(
    "ENOSPC",
  );
  expect(action).not.toHaveBeenCalled();
  expect([...f.enabled].sort()).toEqual(f.original.sort());
});
it("retains the recovery journal after failed deployment and blocks an unsafe retry", async () => {
  const f = await quiescedFixture();
  await expect(
    withQuiescedRecovery(f.options, () =>
      Promise.reject(new Error("deployment failed")),
    ),
  ).rejects.toThrow("RECOVERY_REVIEW_REQUIRED");
  const journal = JSON.parse(
    await readFile(join(f.store.root, "operation.json"), "utf8"),
  ) as { pointId: string };
  expect(journal.pointId).toMatch(/^rp-/);
  await expect(
    withQuiescedRecovery(
      {
        ...f.options,
        owner: (pid = 999) =>
          Promise.resolve({
            pid,
            start: "124",
            boot: "new-boot",
          }),
      },
      async () => {},
    ),
  ).rejects.toThrow("RECOVERY_REVIEW_REQUIRED");
});

it("does not report a completed deployment as failed solely because post-update GC fails", async () => {
  const f = await quiescedFixture();
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  await withQuiescedRecovery(f.options, () => {
    vi.spyOn(f.store, "collect").mockRejectedValue(new Error("GC failed"));
    return Promise.resolve();
  });
  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining("Recovery GC failed"),
  );
  expect(await readdir(f.store.root)).not.toContain("operation.json");
  warning.mockRestore();
});
it("never guesses a live owner or corrupt journal is safe to discard", async () => {
  const f = await quiescedFixture();
  await f.store.initialize();
  await f.store.atomic("operation.json", {
    format: 1,
    owner: await f.options.owner(),
    units: [],
    pointId: null,
  });
  await expect(withQuiescedRecovery(f.options, async () => {})).rejects.toThrow(
    "RECOVERY_BUSY",
  );
  await f.store.atomic("operation.json", { bad: true });
  await expect(withQuiescedRecovery(f.options, async () => {})).rejects.toThrow(
    "Corrupt recovery",
  );
});

it("rejects a foreign-key-broken database before publishing any point", async () => {
  const f = await fixture();
  const db = new DatabaseSync(f.database);
  db.exec(
    "PRAGMA foreign_keys=OFF; CREATE TABLE child(owner REFERENCES owner(id)); INSERT INTO child VALUES('missing');",
  );
  db.close();
  await expect(f.store.create(f)).rejects.toThrow("database verification");
  expect(await f.store.points()).toEqual([]);
  expect(await readdir(join(f.store.root, "staging"))).toEqual([]);
});

it("collects abandoned private staging but preserves a protected expired point", async () => {
  const f = await fixture(),
    point = await f.store.create(f);
  const abandoned = join(f.store.root, "staging/work-abcdef");
  await mkdir(abandoned, { mode: 0o700 });
  await writeFile(join(abandoned, "plaintext"), "discard interrupted staging", {
    mode: 0o600,
  });
  await f.store.collect({
    protectedId: point.id,
    now: now + 8 * 24 * 3600_000,
  });
  expect(await readdir(join(f.store.root, "staging"))).toEqual([]);
  expect(await f.store.points()).toHaveLength(1);
});

it("attempts all unit restorations and retains the journal when a restoration fails", async () => {
  const f = await quiescedFixture();
  const run = (...args: string[]) => {
    if (args[0] === "start" && args[1] === "latex-renderer-api.service")
      throw new Error("start failed");
    f.options.run(...args);
  };
  await expect(
    withQuiescedRecovery({ ...f.options, run }, () => Promise.resolve()),
  ).rejects.toThrow("could not restore units");
  expect(f.enabled.has("latex-renderer-worker.service")).toBe(true);
  expect(f.enabled.has("latex-renderer-cleanup.timer")).toBe(true);
  expect(await readdir(f.store.root)).toContain("operation.json");
});
