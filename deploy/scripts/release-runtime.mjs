import { constants } from "node:fs";
import { lstat, open, readdir, readlink, realpath, rm } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const policyPath = "deploy/runtime-dependencies.json";
const packageName =
  /^(?:@[A-Za-z0-9_~][A-Za-z0-9._~-]*\/)?[A-Za-z0-9_~][A-Za-z0-9._~-]*$/;
const inside = (root, path) => path === root || path.startsWith(root + sep);
const missing = (error) => error?.code === "ENOENT";

async function jsonFile(path, budget) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size > 256 * 1024)
      throw new Error(
        "Runtime dependency metadata must be a bounded regular file",
      );
    budget.bytes += before.size;
    if (budget.bytes > 8 * 1024 * 1024)
      throw new Error("Runtime dependency metadata budget exceeded");
    const bytes = await file.readFile();
    const after = await file.stat();
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error("Runtime dependency metadata changed during inspection");
    return JSON.parse(bytes.toString("utf8"));
  } finally {
    await file.close();
  }
}

function validPackage(name) {
  if (typeof name !== "string" || name.length > 214 || !packageName.test(name))
    throw new Error("Invalid runtime dependency package name");
  return name;
}

function validFile(path) {
  if (
    typeof path !== "string" ||
    path.length > 1024 ||
    path.includes("\\") ||
    path.split("/").some((part) => !part || part === "." || part === "..") ||
    path.startsWith("/")
  )
    throw new Error("Invalid required runtime file");
  return path;
}

// This operates only on a new private assembly, never the writable build tree
// or an installed release. Its policy and workspace manifests come from the
// verified source; package data has already been copied into the private tree.
export async function pruneRuntimeDependencies(root) {
  try {
    await lstat(join(root, policyPath));
  } catch (error) {
    if (missing(error))
      return { enabled: false, selectedPackages: 0, removedPackages: 0 };
    throw error;
  }
  const entry = await lstat(root);
  if (
    resolve(root) !== root ||
    (await realpath(root)) !== root ||
    !entry.isDirectory() ||
    entry.uid !== process.getuid() ||
    entry.mode & 0o077
  )
    throw new Error(
      "Runtime dependency selection requires a private owned assembly",
    );
  const budget = { bytes: 0 };
  // Validate every inode before removing anything. In particular rm must not
  // descend into a bind mount or through a symlink used as a directory root.
  async function inspect(path) {
    const info = await lstat(path);
    if (info.dev !== entry.dev)
      throw new Error("Runtime assembly crosses a filesystem boundary");
    if (info.isSymbolicLink()) {
      if (!inside(root, resolve(dirname(path), await readlink(path))))
        throw new Error("External runtime symlink");
      try {
        if (!inside(root, await realpath(path)))
          throw new Error("External runtime symlink");
      } catch (error) {
        if (!missing(error)) throw error;
      }
    } else if (info.isDirectory()) {
      for (const name of await readdir(path)) await inspect(join(path, name));
    } else if (!info.isFile())
      throw new Error("Special runtime assembly entry");
  }
  await inspect(root);
  const storePath = join(root, "node_modules/.pnpm");
  if (
    !(await lstat(storePath)).isDirectory() ||
    (await realpath(storePath)) !== storePath
  )
    throw new Error(
      "Runtime dependency store must be a real contained directory",
    );
  const policy = await jsonFile(join(root, policyPath), budget);
  if (
    policy.schemaVersion !== 1 ||
    !Array.isArray(policy.rootPackages) ||
    policy.rootPackages.length > 32 ||
    !Array.isArray(policy.requiredFiles) ||
    policy.requiredFiles.length > 64
  )
    throw new Error("Invalid runtime dependency policy");
  for (const name of policy.rootPackages) validPackage(name);
  for (const path of policy.requiredFiles) validFile(path);

  async function packageAt(name, from) {
    validPackage(name);
    for (let path = from; inside(root, path); path = dirname(path)) {
      try {
        const target = await realpath(join(path, "node_modules", name));
        if (!inside(root, target))
          throw new Error("External runtime dependency");
        return target;
      } catch (error) {
        if (!missing(error)) throw error;
      }
      if (path === root) break;
    }
    return null;
  }

  const queue = [],
    enqueued = new Set(),
    selected = new Set(),
    bins = new Set();
  const enqueue = (path) => {
    if (enqueued.has(path)) return;
    if (enqueued.size >= 4096)
      throw new Error("Runtime dependency package limit exceeded");
    enqueued.add(path);
    queue.push(path);
  };
  enqueue(root);
  for (const group of ["apps", "packages"]) {
    for (const name of await readdir(join(root, group))) {
      const path = join(root, group, name);
      try {
        const canonical = await realpath(path);
        if (!inside(root, canonical))
          throw new Error("External workspace package");
        await lstat(join(canonical, "package.json"));
        enqueue(canonical);
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
  }
  for (const name of policy.rootPackages) {
    const path = await packageAt(name, root);
    if (!path) throw new Error(`Required runtime package is missing: ${name}`);
    enqueue(path);
  }
  for (let index = 0; index < queue.length; index++) {
    const path = queue[index],
      value = await jsonFile(join(path, "package.json"), budget);
    selected.add(path);
    const required = new Set(Object.keys(value.dependencies ?? {}));
    const optional = new Set(Object.keys(value.optionalDependencies ?? {}));
    const dependencies = new Set([
      ...required,
      ...optional,
      ...Object.keys(value.peerDependencies ?? {}),
    ]);
    if (dependencies.size > 2048)
      throw new Error("Runtime package dependency limit exceeded");
    for (const name of dependencies) {
      const target = await packageAt(name, path);
      if (target) enqueue(target);
      else if (required.has(name) && !optional.has(name))
        throw new Error(`Required runtime dependency is missing: ${name}`);
    }
    const commands =
      typeof value.bin === "string"
        ? { [String(value.name).split("/").at(-1)]: value.bin }
        : (value.bin ?? {});
    for (const [name, file] of Object.entries(commands)) {
      if (
        !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,199}$/.test(name) ||
        typeof file !== "string"
      )
        throw new Error("Invalid runtime executable binding");
      const lexical = resolve(path, file);
      if (!inside(path, lexical))
        throw new Error("External runtime executable");
      try {
        if (!inside(root, await realpath(lexical)))
          throw new Error("External runtime executable");
        bins.add(name);
      } catch (error) {
        // Source-only workspace CLIs are distributed in the client archive;
        // production builds need not produce their host-side bin targets.
        if (!missing(error)) throw error;
      }
    }
  }
  const store = join(root, "node_modules/.pnpm"),
    keptSlots = new Set();
  for (const path of selected) {
    const slot = relative(store, path).split(sep)[0];
    if (slot && slot !== ".." && !slot.startsWith(".." + sep))
      keptSlots.add(slot);
  }
  let removedPackages = 0;
  for (const name of await readdir(store)) {
    if (name === "node_modules" || keptSlots.has(name)) continue;
    const path = join(store, name),
      info = await lstat(path);
    if (info.isDirectory()) {
      await rm(path, { recursive: true });
      removedPackages++;
    }
  }
  async function bindings(path) {
    if (!(await lstat(path)).isDirectory())
      throw new Error("Runtime dependency directory must not be a symlink");
    for (const child of await readdir(path, { withFileTypes: true })) {
      const target = join(path, child.name);
      if (basename(path) === ".bin" && !bins.has(child.name)) {
        await rm(target, { recursive: false });
      } else if (child.isSymbolicLink()) {
        const lexical = resolve(path, await readlink(target));
        if (!inside(root, lexical)) throw new Error("External runtime symlink");
        const binding =
          (basename(path) === "node_modules" && !child.name.startsWith("@")) ||
          (basename(dirname(path)) === "node_modules" &&
            basename(path).startsWith("@"));
        try {
          const canonical = await realpath(target);
          if (!inside(root, canonical))
            throw new Error("External runtime symlink");
          if (binding && !selected.has(canonical)) await rm(target);
        } catch (error) {
          if (!missing(error) || (!binding && basename(path) !== ".bin"))
            throw error;
          await rm(target);
        }
      } else if (child.isDirectory()) await bindings(target);
    }
  }
  await bindings(join(root, "node_modules"));
  for (const group of ["apps", "packages"]) {
    for (const name of await readdir(join(root, group))) {
      const path = join(root, group, name, "node_modules");
      try {
        await lstat(path);
      } catch (error) {
        if (missing(error)) continue;
        throw error;
      }
      await bindings(path);
    }
  }
  for (const path of policy.requiredFiles) {
    const canonical = await realpath(join(root, path));
    if (!inside(root, canonical) || !(await lstat(canonical)).isFile())
      throw new Error("Required runtime file is missing or unsafe");
  }
  return { enabled: true, selectedPackages: selected.size, removedPackages };
}
