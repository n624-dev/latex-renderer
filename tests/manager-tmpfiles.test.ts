import { spawnSync } from "node:child_process";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it as baseIt } from "vitest";
import { installManagerTmpfiles } from "../deploy/scripts/install-manager-tmpfiles.mjs";

const it = baseIt.skipIf(process.platform === "win32");
const roots: string[] = [];
const name = "latex-renderer-image-manager.conf";
const policy = () => readFile(`deploy/tmpfiles.d/${name}`, "utf8");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "manager-tmpfiles-"));
  roots.push(root);
  const directory = join(root, "etc/tmpfiles.d");
  await mkdir(directory, { recursive: true, mode: 0o755 });
  return { root, directory, target: join(directory, name) };
}
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

it("replaces legacy policy completely before applying and is repeatable", async () => {
  const { directory, target } = await fixture();
  await writeFile(
    target,
    "d /var/lib/latex-renderer/update-manager/staging 0750 root root -\n",
  );
  const old = await lstat(target);
  let calls = 0;
  const apply = async (path: string) => {
    calls++;
    expect(path).toBe(target);
    expect(await readFile(path, "utf8")).toBe(await policy());
    expect((await lstat(path)).ino).not.toBe(old.ino);
    expect((await lstat(path)).mode & 0o777).toBe(0o644);
  };
  await installManagerTmpfiles(directory, apply);
  await installManagerTmpfiles(directory, async (path) => {
    calls++;
    expect(await readFile(path, "utf8")).toBe(await policy());
  });
  expect(calls).toBe(2);
  expect(await readdir(directory)).toEqual([name]);
});

it("installs on a fresh host even under umask 077", async () => {
  const { directory, target } = await fixture();
  const mask = process.umask(0o077);
  try {
    await installManagerTmpfiles(directory, () => undefined);
    expect((await lstat(target)).mode & 0o777).toBe(0o644);
  } finally {
    process.umask(mask);
  }
});

it("propagates OS apply failure, leaves a complete retryable policy, and cleans temporary files", async () => {
  const { directory, target } = await fixture();
  await expect(
    installManagerTmpfiles(directory, () => {
      throw new Error("tmpfiles failed");
    }),
  ).rejects.toThrow("tmpfiles failed");
  expect(await readFile(target, "utf8")).toBe(await policy());
  expect(await readdir(directory)).toEqual([name]);
  await installManagerTmpfiles(directory, () => undefined);
});

it.each(["symlink", "hardlink", "directory"])(
  "refuses an unexpected %s target without changing other data",
  async (kind) => {
    const { root, directory, target } = await fixture();
    const sentinel = join(root, "sentinel");
    await writeFile(sentinel, "keep");
    if (kind === "symlink") await symlink(sentinel, target);
    else if (kind === "hardlink") await link(sentinel, target);
    else await mkdir(target);
    let applied = false;
    await expect(
      installManagerTmpfiles(directory, () => {
        applied = true;
      }),
    ).rejects.toThrow("owned regular file");
    expect(applied).toBe(false);
    expect(await readFile(sentinel, "utf8")).toBe("keep");
    expect(await readdir(directory)).toEqual([name]);
  },
);

it("refuses a linked or writable policy directory", async () => {
  const { root, directory } = await fixture();
  const alias = join(root, "alias");
  await symlink(directory, alias);
  await expect(installManagerTmpfiles(alias, () => undefined)).rejects.toThrow(
    "trusted directory",
  );
  await chmod(directory, 0o777);
  await expect(
    installManagerTmpfiles(directory, () => undefined),
  ).rejects.toThrow("trusted directory");
  expect(await readdir(directory)).toEqual([]);
});

it("uses one policy on initial install and upgrades, before changing current", async () => {
  const invocation =
    '/usr/local/bin/node "$source_root/deploy/scripts/install-manager-tmpfiles.mjs"';
  for (const name of ["install-host", "prepare-host"]) {
    const script = await readFile(`deploy/scripts/${name}.sh`, "utf8");
    expect(script.split(invocation)).toHaveLength(2);
    expect(script).not.toContain("--clean");
    if (name === "prepare-host")
      expect(script.indexOf(invocation)).toBeLessThan(
        script.indexOf('ln -sfn "$release_root"'),
      );
  }
  const text = await policy();
  expect(text).not.toMatch(/^e .*\/update-manager(?:\/|\s)/m);
  const implementation = await readFile(
    "deploy/scripts/install-manager-tmpfiles.mjs",
    "utf8",
  );
  expect(implementation).toContain('["--create", path]');
  expect(implementation).toContain(
    "process.getuid() !== 0 || process.argv.length !== 2",
  );
});

baseIt.skipIf(process.platform !== "linux")(
  "applies the real policy with systemd-tmpfiles in an isolated root, including a later OS pass",
  async () => {
    const { root, directory, target } = await fixture();
    const uid = process.getuid?.(),
      gid = process.getgid?.();
    // Isolated passwd/group map service names to the test user's IDs. No root,
    // real service accounts, host paths or running services are touched.
    await writeFile(
      join(root, "etc/passwd"),
      `fixture-root:x:${uid}:${gid}::/:/bin/false\nlatex-renderer-update:x:${uid}:${gid}::/:/bin/false\n`,
    );
    await writeFile(join(root, "etc/group"), `latex-renderer:x:${gid}:\n`);
    const staging = join(root, "var/lib/latex-renderer/update-manager/staging");
    await mkdir(staging, { recursive: true });
    await chmod(staging, 0o750);
    await writeFile(join(staging, "in-progress"), "keep staged bytes");
    const apply = async () => {
      // systemd resolves the special name "root" to UID 0 regardless of the
      // isolated passwd file. Remap only that user field for this non-root test.
      const input = (await readFile(target, "utf8")).replace(
        /^(d \S+ \S+) root /gm,
        "$1 fixture-root ",
      );
      const result = spawnSync(
        "systemd-tmpfiles",
        ["--root", root, "--create", "-"],
        { encoding: "utf8", input },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
    };
    await writeFile(target, "# obsolete host policy\n");
    await installManagerTmpfiles(directory, apply);
    await apply();
    const info = await lstat(staging);
    expect(info.mode & 0o777).toBe(0o700);
    expect(info.uid).toBe(uid);
    expect(await readFile(join(staging, "in-progress"), "utf8")).toBe(
      "keep staged bytes",
    );
  },
);
