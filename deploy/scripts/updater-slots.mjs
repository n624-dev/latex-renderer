import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  chmod,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

// A clean first migration may already hold the application mutation lock while
// systemd starts the new recovery dependency. Nothing needs restoring then:
// verify the committed slot read-only, without reacquiring the parent's lock.
// A pending journal still requires exclusive recovery and a fresh state check.
export async function recoverPendingUpdater(slots, acquireLock, restore) {
  const state = await slots.state();
  await slots.verify(state.pending?.from ?? state.current);
  if (!state.pending) return false;
  const lock = await acquireLock();
  try {
    const current = await slots.state();
    await slots.verify(current.pending?.from ?? current.current);
    if (!current.pending) return false;
    await restore();
    await slots.collect();
    return true;
  } finally {
    await lock.release();
  }
}

// Bootstrap protocol 1 is independent of application release/database schemas.
export const UPDATER_FILES = Object.freeze([
  "package.json",
  ...[
    "update-manager.mjs",
    "update-manager-helper.mjs",
    "environment.mjs",
    "release-assembly.mjs",
    "release-archive.mjs",
    "release-attestation.mjs",
    "release-version.mjs",
    "runtime-image-identity.mjs",
    "mutation-lock.mjs",
    "deploy-production-release.sh",
  ].map((name) => `deploy/scripts/${name}`),
]);
const idPattern = /^[a-f0-9]{64}$/;
const maxBytes = 4 * 1024 * 1024;
const hash = (data) => createHash("sha256").update(data).digest("hex");

async function regular(path, uid) {
  const info = await lstat(path);
  if (
    !info.isFile() ||
    info.uid !== uid ||
    info.mode & 0o022 ||
    info.size > maxBytes
  )
    throw new Error("Updater control file is not sealed or bounded");
  return info;
}

async function directory(path, uid) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== uid || info.mode & 0o022)
    throw new Error("Updater directory is not sealed");
  if ((await realpath(path)) !== resolve(path))
    throw new Error("Updater path contains a symbolic link");
}

export async function updaterEnvelope(
  source,
  { version, commit },
  legacy = false,
) {
  if (
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(version) ||
    !/^[a-f0-9]{40}$/.test(commit)
  )
    throw new Error("Invalid Updater version/commit");
  const files = {};
  const paths = legacy
    ? UPDATER_FILES
    : JSON.parse(
        await readFile(join(source, "deploy/updater-files.json"), "utf8"),
      );
  if (
    !Array.isArray(paths) ||
    paths.length > 64 ||
    new Set(paths).size !== paths.length ||
    paths.some(
      (path) =>
        typeof path !== "string" ||
        !(
          path === "package.json" ||
          /^deploy\/scripts\/[A-Za-z0-9_-]+\.(?:mjs|sh)$/.test(path)
        ),
    )
  )
    throw new Error("Invalid Updater file selection");
  for (const path of paths) {
    try {
      const info = await lstat(join(source, path));
      if (!info.isFile() || info.size > maxBytes)
        throw new Error("Invalid Updater payload");
      const bytes = await readFile(join(source, path));
      files[path] = { sha256: hash(bytes), bytes: bytes.length };
    } catch (error) {
      // The historical controller has no release-attestation import.
      if (!(
        legacy &&
        path === "deploy/scripts/release-attestation.mjs" &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  return { schemaVersion: 1, requiredNodeMajor: 24, version, commit, files };
}

function validateEnvelope(value) {
  if (
    value?.schemaVersion !== 1 ||
    value.requiredNodeMajor !== 24 ||
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(value.version ?? "") ||
    !/^[a-f0-9]{40}$/.test(value.commit ?? "") ||
    !value.files ||
    Array.isArray(value.files)
  )
    throw new Error("Unsupported Updater envelope");
  const keys = Object.keys(value.files);
  if (
    keys.length < 2 ||
    keys.length > 64 ||
    ![
      "deploy/scripts/update-manager.mjs",
      "deploy/scripts/update-manager-helper.mjs",
    ].every((path) => keys.includes(path))
  )
    throw new Error("Incomplete Updater payload");
  for (const [path, file] of Object.entries(value.files)) {
    if (
      !(
        path === "package.json" ||
        /^deploy\/scripts\/[A-Za-z0-9_-]+\.(?:mjs|sh)$/.test(path)
      ) ||
      !idPattern.test(file?.sha256 ?? "") ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 1 ||
      file.bytes > maxBytes
    )
      throw new Error("Invalid Updater payload entry");
  }
}

export class UpdaterSlots {
  constructor(root, uid = process.getuid()) {
    this.root = resolve(root);
    this.uid = uid;
  }
  async initialize() {
    await mkdir(this.root, { recursive: true, mode: 0o755 });
    await directory(this.root, this.uid);
    await chmod(this.root, 0o755);
    await mkdir(join(this.root, "slots"), { mode: 0o755 }).catch((e) => {
      if (e.code !== "EEXIST") throw e;
    });
    await directory(join(this.root, "slots"), this.uid);
    await chmod(join(this.root, "slots"), 0o755);
  }
  async atomic(path, data, mode = 0o644) {
    const temporary = `${path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", mode);
    try {
      await handle.chmod(mode);
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
    const parent = await open(dirname(path), "r");
    try {
      await parent.sync();
    } finally {
      await parent.close();
    }
  }
  async state() {
    await directory(this.root, this.uid);
    const path = join(this.root, "state.json");
    await regular(path, this.uid);
    const value = JSON.parse(await readFile(path, "utf8"));
    if (
      value?.schemaVersion !== 1 ||
      !idPattern.test(value.current ?? "") ||
      ![value.previous, value.candidate].every(
        (id) => id === null || (typeof id === "string" && idPattern.test(id)),
      ) ||
      !(
        value.pending === null ||
        (idPattern.test(value.pending?.from ?? "") &&
          (value.pending.previous === null ||
            idPattern.test(value.pending.previous ?? "")))
      )
    )
      throw new Error("Updater activation state is corrupt; refusing changes");
    return value;
  }
  async save(value) {
    await this.atomic(
      join(this.root, "state.json"),
      JSON.stringify(value) + "\n",
    );
  }
  async verify(id) {
    if (!idPattern.test(id)) throw new Error("Invalid Updater slot ID");
    const root = join(this.root, "slots", id);
    await directory(root, this.uid);
    await directory(join(root, "deploy"), this.uid);
    await directory(join(root, "deploy/scripts"), this.uid);
    const envelopePath = join(root, "envelope.json");
    await regular(envelopePath, this.uid);
    const raw = await readFile(envelopePath);
    if (hash(raw) !== id) throw new Error("Updater slot identity mismatch");
    const envelope = JSON.parse(raw);
    validateEnvelope(envelope);
    for (const [path, file] of Object.entries(envelope.files)) {
      await regular(join(root, path), this.uid);
      const bytes = await readFile(join(root, path));
      if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
        throw new Error("Updater payload checksum mismatch");
    }
    return { root, envelope };
  }
  async stage(source, envelope) {
    await this.initialize();
    try {
      await this.state();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    validateEnvelope(envelope);
    await directory(source, this.uid);
    await directory(join(source, "deploy"), this.uid);
    await directory(join(source, "deploy/scripts"), this.uid);
    const raw = Buffer.from(JSON.stringify(envelope) + "\n"),
      id = hash(raw);
    const destination = join(this.root, "slots", id);
    let exists = true;
    try {
      await lstat(destination);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      exists = false;
    }
    if (exists) {
      await this.verify(id);
      return id;
    }
    const stage = join(this.root, `stage-${randomUUID()}`);
    await mkdir(join(stage, "deploy/scripts"), {
      recursive: true,
      mode: 0o755,
    });
    for (const path of [
      stage,
      join(stage, "deploy"),
      join(stage, "deploy/scripts"),
    ])
      await chmod(path, 0o755);
    try {
      for (const [path, file] of Object.entries(envelope.files)) {
        await regular(join(source, path), this.uid);
        const bytes = await readFile(join(source, path));
        if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
          throw new Error("Updater payload checksum mismatch");
        await this.atomic(join(stage, path), bytes);
      }
      await this.atomic(join(stage, "envelope.json"), raw);
      await rename(stage, destination);
      const parent = await open(join(this.root, "slots"), "r");
      try {
        await parent.sync();
      } finally {
        await parent.close();
      }
      await this.verify(id);
      return id;
    } finally {
      await rm(stage, { recursive: true, force: true });
    }
  }
  async nominate(id) {
    await this.verify(id);
    let value;
    try {
      value = await this.state();
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.save({
        schemaVersion: 1,
        current: id,
        previous: null,
        candidate: null,
        pending: null,
      });
      return;
    }
    if (value.pending)
      throw new Error("Recover interrupted Updater activation first");
    value.candidate = id === value.current ? null : id;
    await this.save(value);
  }
  async begin() {
    const value = await this.state();
    if (value.pending)
      throw new Error("Recover interrupted Updater activation first");
    if (!value.candidate) return false;
    await this.verify(value.current);
    await this.verify(value.candidate);
    await this.save({
      ...value,
      current: value.candidate,
      previous: value.current,
      candidate: null,
      pending: { from: value.current, previous: value.previous },
    });
    return true;
  }
  async finish() {
    const value = await this.state();
    await this.verify(value.current);
    await this.save({ ...value, pending: null });
  }
  async recover() {
    const value = await this.state();
    if (!value.pending) return false;
    await this.verify(value.pending.from);
    await this.save({
      ...value,
      current: value.pending.from,
      previous: value.pending.previous,
      candidate: null,
      pending: null,
    });
    return true;
  }
  async collect() {
    const value = await this.state();
    if (value.pending)
      throw new Error("Cannot prune during Updater activation");
    const keep = new Set([value.current, value.previous, value.candidate]);
    for (const id of keep) if (id) await this.verify(id);
    // No recursive delete of unknown trees, symlinks or mount points.
    const safeDelete = async (path) => {
      const mounts = (await readFile("/proc/self/mountinfo", "utf8"))
        .split("\n")
        .map((line) =>
          line
            .split(" ")[4]
            ?.replace(/\\([0-7]{3})/g, (_, octal) =>
              String.fromCharCode(parseInt(octal, 8)),
            ),
        )
        .filter(Boolean);
      if (
        mounts.some((mount) => mount === path || mount.startsWith(`${path}/`))
      )
        throw new Error("Refusing to traverse an Updater mount point");
      const parentInfo = await lstat(this.root);
      const visit = async (target) => {
        const info = await lstat(target);
        if (
          info.uid !== this.uid ||
          info.dev !== parentInfo.dev ||
          info.isSymbolicLink()
        )
          throw new Error("Unsafe Updater cleanup target");
        if (info.isDirectory())
          for (const name of await readdir(target))
            await visit(join(target, name));
        else if (!info.isFile())
          throw new Error("Unexpected Updater cleanup entry");
      };
      await visit(path);
      await rm(path, { recursive: true });
    };
    for (const id of await readdir(join(this.root, "slots"))) {
      if (!idPattern.test(id))
        throw new Error("Unexpected Updater slot directory");
      if (!keep.has(id)) await safeDelete(join(this.root, "slots", id));
    }
    for (const name of await readdir(this.root))
      if (
        /^stage-[a-f0-9-]{36}$/.test(name) ||
        /^(?:state|controller-state-backup)\.json\.[a-f0-9-]{36}\.tmp$/.test(
          name,
        )
      )
        await safeDelete(join(this.root, name));
  }
}
