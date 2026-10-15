import {
  mkdtemp,
  rm,
  stat,
  writeFile,
  readFile,
  symlink,
  link,
  chmod,
  mkdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { runInNewContext } from "node:vm";
import { afterEach, expect, it as baseIt } from "vitest";
import {
  prepareApplicationDatabase,
  prepareInitialDeploymentDatabase,
} from "../deploy/scripts/application-database-file.mjs";

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
  expect(initial).toContain("prepareInitialDeploymentDatabase");
  expect(initial.indexOf("prepareInitialDeploymentDatabase")).toBeLessThan(
    initial.indexOf("await deployFromAssembly"),
  );
  expect(
    JSON.parse(await readFile("deploy/updater-files.json", "utf8")),
  ).toContain("deploy/scripts/application-database-file.mjs");
});

async function initialFixture(modern = true) {
  const f = await fixture();
  const scripts = join(f.root, "deploy/scripts");
  await mkdir(scripts, { recursive: true });
  const module = join(scripts, "application-database-file.mjs");
  const driver = join(scripts, "deploy-production-release.sh");
  await writeFile(
    driver,
    modern
      ? await readFile("deploy/scripts/deploy-production-release.sh", "utf8")
      : "#!/bin/sh\n# Historical driver without explicit SQLite preparation.\n",
  );
  if (modern) await writeFile(module, "// signed preparation fixture\n");
  return { ...f, module, driver };
}

it("leaves the DB absent through modern driver preflight, then preserves shared SQLite modes", async () => {
  const f = await initialFixture();
  await prepareInitialDeploymentDatabase(f.path, identity, f.root);
  await expect(stat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  // The real driver owns this step after both preflight checks, not the
  // bootstrap helper. Reproduce the zero-byte file that broke RC1 preflight.
  await prepareApplicationDatabase(f.path, identity);
  expect((await stat(f.path)).size).toBe(0);
  const db = new DatabaseSync(f.path);
  try {
    db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE system_settings(value_json TEXT)",
    );
    db.exec(`INSERT INTO system_settings VALUES ('"normal"')`);
    for (const suffix of ["", "-wal", "-shm"])
      expect((await stat(f.path + suffix)).mode & 0o777).toBe(0o660);
  } finally {
    db.close();
  }
});

it("retains exclusive shared-file creation for immutable historical drivers", async () => {
  const f = await initialFixture(false);
  await prepareInitialDeploymentDatabase(f.path, identity, f.root);
  expect((await stat(f.path)).size).toBe(0);
  expect((await stat(f.path)).mode & 0o777).toBe(0o660);
  await expect(
    prepareInitialDeploymentDatabase(f.path, identity, f.root),
  ).rejects.toThrow("cannot overwrite");
});

it.each([true, false])(
  "preserves existing DB bytes and modes (modern=%s)",
  async (modern) => {
    const f = await initialFixture(modern);
    await writeFile(f.path, "existing", { mode: 0o600 });
    await expect(
      prepareInitialDeploymentDatabase(f.path, identity, f.root),
    ).rejects.toThrow("cannot overwrite");
    expect(await readFile(f.path, "utf8")).toBe("existing");
    expect((await stat(f.path)).mode & 0o777).toBe(0o600);
  },
);

it.each(["-wal", "-shm", "-journal"])(
  "refuses orphaned %s before modern initial deployment",
  async (suffix) => {
    const f = await initialFixture();
    await writeFile(f.path + suffix, "keep");
    await expect(
      prepareInitialDeploymentDatabase(f.path, identity, f.root),
    ).rejects.toThrow("SQLite sidecar");
    expect(await readFile(f.path + suffix, "utf8")).toBe("keep");
    await expect(stat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each(["missing-module", "missing-call", "symlink-module"])(
  "fails closed for an inconsistent verified driver (%s)",
  async (kind) => {
    const f = await initialFixture();
    if (kind === "missing-module") await rm(f.module);
    if (kind === "missing-call") await writeFile(f.driver, "#!/bin/sh\n");
    if (kind === "symlink-module") {
      await rm(f.module);
      await symlink(f.driver, f.module);
    }
    await expect(
      prepareInitialDeploymentDatabase(f.path, identity, f.root),
    ).rejects.toThrow(/contract|module/);
    await expect(stat(f.path)).rejects.toMatchObject({ code: "ENOENT" });
  },
);

it.each([
  "success",
  "preparation-failure",
  "deployment-failure",
  "existing-update",
])(
  "serializes initial database preparation and releases its lock (%s)",
  async (scenario) => {
    const source = await readFile(
      "deploy/scripts/update-manager-helper.mjs",
      "utf8",
    );
    const entry = source
      .slice(
        source.indexOf("export async function deploySealedAssembly("),
        source.indexOf("async function installedRelease("),
      )
      .replace("export async function", "async function");
    const events: string[] = [];
    const initial = scenario !== "existing-update";
    const invoke = runInNewContext(`${entry}; deploySealedAssembly`, {
      assertSealedControlTree: () => events.push("sealed"),
      acquireMutationLockForPath: (path: string) => {
        expect(path).toBe("/sealed-staging/initial-install.lock");
        events.push("lock");
        return { release: () => events.push("release") };
      },
      join,
      privilegedStagingRoot: "/sealed-staging",
      prepareDeploymentTrees: () => {
        events.push("trees");
        return {};
      },
      applicationDatabaseIdentity: () => identity,
      prepareInitialDeploymentDatabase: () => {
        events.push("database");
        if (scenario === "preparation-failure")
          throw new Error("prepare failed");
      },
      runLogged: () => events.push("backup"),
      deployFromAssembly: (
        _assembly: string,
        _deployment: unknown,
        _releaseId: string,
        options: { ownsParentMutationLock: boolean },
      ) => {
        expect(options.ownsParentMutationLock).toBe(!initial);
        events.push("deploy");
        if (scenario === "deployment-failure") throw new Error("deploy failed");
      },
    }) as (
      assembly: string,
      stage: string,
      release: { version: string },
      manifest: { commit: string },
      initial: boolean,
    ) => Promise<string>;
    const result = invoke(
      "sealed",
      "stage",
      { version: "9.8.7" },
      { commit: "a".repeat(40) },
      initial,
    );
    if (scenario.includes("failure"))
      await expect(result).rejects.toThrow("failed");
    else expect(await result).toBe("v9.8.7-aaaaaaaaaaaa");
    expect(events).toEqual(
      scenario === "existing-update"
        ? ["sealed", "trees", "backup", "deploy"]
        : scenario === "preparation-failure"
          ? ["sealed", "lock", "trees", "database", "release"]
          : ["sealed", "lock", "trees", "database", "deploy", "release"],
    );
  },
);
