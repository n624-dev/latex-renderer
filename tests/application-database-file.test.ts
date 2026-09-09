import {
  mkdtemp,
  rm,
  stat,
  writeFile,
  readFile,
  symlink,
  link,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it as baseIt } from "vitest";
import { prepareApplicationDatabase } from "../deploy/scripts/application-database-file.mjs";

const roots: string[] = [];
const it = baseIt.skipIf(process.platform === "win32");
const identity = { uid: process.getuid?.() ?? 0, gid: process.getgid?.() ?? 0 };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "application-db-mode-"));
  roots.push(root);
  return { root, path: join(root, "renderer.sqlite3") };
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("sets explicit shared mode despite restrictive umask, including SQLite WAL/SHM", async () => {
  const { path } = await fixture();
  const mask = process.umask(0o077);
  let db: DatabaseSync | undefined;
  try {
    await prepareApplicationDatabase(path, { ...identity, createOnly: true });
    db = new DatabaseSync(path);
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE t(value); INSERT INTO t VALUES(42)",
    );
    for (const suffix of ["", "-wal", "-shm"])
      expect((await stat(path + suffix)).mode & 0o777).toBe(0o660);
    expect(db.prepare("SELECT value FROM t").get()?.value).toBe(42);
  } finally {
    db?.close();
    process.umask(mask);
  }
});
it("repairs existing file modes without changing data, inode or truncating sidecars", async () => {
  const { path } = await fixture();
  for (const suffix of ["", "-wal", "-shm", "-journal"])
    await writeFile(path + suffix, `preserve${suffix}`, { mode: 0o640 });
  const before = await stat(path);
  await prepareApplicationDatabase(path, identity);
  await prepareApplicationDatabase(path, identity);
  expect((await stat(path)).ino).toBe(before.ino);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    expect(await readFile(path + suffix, "utf8")).toBe(`preserve${suffix}`);
    expect((await stat(path + suffix)).mode & 0o777).toBe(0o660);
  }
});
it("refuses initial install over an existing database", async () => {
  const { path } = await fixture();
  await writeFile(path, "existing", { mode: 0o600 });
  await expect(
    prepareApplicationDatabase(path, { ...identity, createOnly: true }),
  ).rejects.toMatchObject({ code: "EEXIST" });
  expect(await readFile(path, "utf8")).toBe("existing");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});
it.each(["symlink", "hardlink"])(
  "refuses %s targets without changing their mode",
  async (kind) => {
    const { root, path } = await fixture();
    const target = join(root, "outside");
    await writeFile(target, "keep");
    await chmod(target, 0o600);
    if (kind === "symlink") await symlink(target, path);
    else await link(target, path);
    await expect(prepareApplicationDatabase(path, identity)).rejects.toThrow();
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  },
);
it("rejects linked WAL and symlinked parent directories", async () => {
  const { root, path } = await fixture();
  const target = join(root, "outside");
  await writeFile(target, "keep", { mode: 0o600 });
  await symlink(target, path + "-wal");
  await expect(prepareApplicationDatabase(path, identity)).rejects.toThrow();
  expect((await stat(target)).mode & 0o777).toBe(0o600);
  const alias = join(root, "alias");
  await symlink(root, alias);
  await expect(
    prepareApplicationDatabase(join(alias, "other.sqlite3"), identity),
  ).rejects.toThrow("real directory");
});
it("refuses orphaned SQLite sidecars instead of attaching them to a new database", async () => {
  const { path } = await fixture();
  await writeFile(path + "-wal", "old WAL", { mode: 0o600 });
  await expect(
    prepareApplicationDatabase(path, { ...identity, createOnly: true }),
  ).rejects.toThrow("existing SQLite sidecars");
  await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await readFile(path + "-wal", "utf8")).toBe("old WAL");
});
it("prepares permissions before opening the database and retains frozen baseline compatibility", async () => {
  const deploy = await readFile(
    "deploy/scripts/deploy-production-release.sh",
    "utf8",
  );
  expect(
    deploy.indexOf(
      '"$source_root/deploy/scripts/application-database-file.mjs"',
    ),
  ).toBeLessThan(deploy.indexOf("web-principals ensure --yes"));
  const helper = await readFile(
    "deploy/scripts/update-manager-helper.mjs",
    "utf8",
  );
  const initial = helper.slice(
    helper.indexOf("export async function deploySealedAssembly"),
    helper.indexOf("async function installedRelease"),
  );
  expect(initial).toContain("createOnly: true");
  expect(initial.indexOf("prepareApplicationDatabase")).toBeLessThan(
    initial.indexOf("await deployFromAssembly"),
  );
  expect(
    JSON.parse(await readFile("deploy/updater-files.json", "utf8")),
  ).toContain("deploy/scripts/application-database-file.mjs");
});
