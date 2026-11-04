import {
  constants,
  mkdirSync,
  lstatSync,
  realpathSync,
  readdirSync,
  readFileSync,
  openSync,
  closeSync,
  fstatSync,
  fsyncSync,
  chmodSync,
  renameSync,
  symlinkSync,
  readlinkSync,
  unlinkSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname } from "node:path";
import { createHash } from "node:crypto";
import { withLanHttpsClientLock } from "./client-state.mjs";
import { isMainModule } from "../scripts/is-main-module.mjs";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const idPattern = /^[a-f0-9]{40}$/;
function checked(path, uid, device) {
  const stat = lstatSync(path);
  if (
    realpathSync(path) !== path ||
    stat.isSymbolicLink() ||
    stat.uid !== uid ||
    stat.mode & 0o022 ||
    (device !== undefined && stat.dev !== device) ||
    (!stat.isFile() && !stat.isDirectory()) ||
    (stat.isFile() && stat.nlink !== 1)
  )
    throw new Error("Unsafe authority release entry");
  return stat;
}
function directory(path, uid, mode = 0o755) {
  try {
    mkdirSync(path, { mode });
    chmodSync(path, mode);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const stat = checked(path, uid);
  if (
    !stat.isDirectory() ||
    realpathSync(path) !== path ||
    (stat.mode & 0o7777) !== mode
  )
    throw new Error("Unsafe authority release directory");
  return stat;
}
function bytes(path, uid, maximum = 21 * 1024 * 1024) {
  const before = checked(path, uid);
  if (!before.isFile() || before.size < 1 || before.size > maximum)
    throw new Error("Invalid authority release file");
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const stat = fstatSync(fd);
    if (stat.ino !== before.ino || stat.dev !== before.dev)
      throw new Error("Authority source changed");
    const data = readFileSync(fd);
    const after = fstatSync(fd);
    if (data.length !== before.size || after.ctimeMs !== before.ctimeMs)
      throw new Error("Authority source changed");
    return data;
  } finally {
    closeSync(fd);
  }
}
function syncDirectory(path) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function write(path, data, mode) {
  writeFileSync(path, data, { flag: "wx", mode });
  chmodSync(path, mode);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function verifyTree(root, uid, manifest) {
  const device = checked(root, uid).dev;
  let count = 0;
  const walk = (path) => {
    const stat = checked(path, uid, device);
    if (++count > 512)
      throw new Error("Authority release tree exceeds its bound");
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) walk(join(path, name));
    } else {
      const relative = path.slice(root.length + 1);
      if (
        relative !== "release.json" &&
        (!manifest.files[relative] ||
          digest(bytes(path, uid)) !== manifest.files[relative])
      )
        throw new Error("Authority release checksum mismatch");
    }
  };
  walk(root);
  for (const name of Object.keys(manifest.files)) {
    if (
      !/^(?:deploy\/lan-https\/(?:[a-z0-9-]+\.(?:mjs|d\.mts|sh)|binaries\.json|bin\/lan-https-linux-(?:amd64|arm64))|deploy\/scripts\/is-main-module\.mjs|packages\/server-setup-core\/src\/[a-z0-9-]+\.(?:mjs|d\.mts))$/.test(
        name,
      )
    )
      throw new Error("Unexpected authority release path");
    checked(join(root, name), uid, device);
  }
}
function marker(root, uid) {
  const value = JSON.parse(bytes(join(root, "release.json"), uid, 65536));
  if (
    value.format !== 1 ||
    !idPattern.test(value.commit) ||
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(value.version) ||
    !["amd64", "arm64"].includes(value.architecture) ||
    !value.files ||
    Array.isArray(value.files) ||
    Object.keys(value.files).length > 128
  )
    throw new Error("Invalid authority release manifest");
  verifyTree(root, uid, value);
  return value;
}
function removeTree(root, uid) {
  const mounts = readFileSync("/proc/self/mountinfo", "utf8");
  if (Buffer.byteLength(mounts) > 4 * 1024 * 1024)
    throw new Error("Cannot verify authority release mounts");
  for (const line of mounts.split("\n")) {
    const point = line
      .split(" ")[4]
      ?.replace(/\\([0-7]{3})/g, (_, octal) =>
        String.fromCharCode(parseInt(octal, 8)),
      );
    if (point === root || point?.startsWith(root + "/"))
      throw new Error("Mounted authority release cannot be removed");
  }
  const device = checked(root, uid).dev;
  const validate = (path) => {
    const stat = checked(path, uid, device);
    if (stat.isDirectory())
      for (const name of readdirSync(path)) validate(join(path, name));
  };
  validate(root);
  const remove = (path) => {
    if (lstatSync(path).isDirectory()) {
      for (const name of readdirSync(path)) remove(join(path, name));
      rmdirSync(path);
    } else unlinkSync(path);
  };
  remove(root);
}
// rootDirectory/uid are injected only for isolated tests. The CLI fixes both.
export async function installLanHttpsAuthorityRelease(
  source,
  { rootDirectory = "/opt/latex-renderer-lan-authority", uid = 0 } = {},
) {
  if (
    process.geteuid() !== uid ||
    source !== resolve(source) ||
    realpathSync(source) !== source ||
    rootDirectory !== resolve(rootDirectory)
  )
    throw new Error(
      "Authority installation requires a canonical verified source and administrator",
    );
  checked(source, uid);
  const release = JSON.parse(
    bytes(join(source, ".latex-renderer-release.json"), uid, 65536),
  );
  const binaryManifest = JSON.parse(
    bytes(join(source, "deploy/lan-https/binaries.json"), uid, 65536),
  );
  const architecture =
    process.arch === "x64"
      ? "amd64"
      : process.arch === "arm64"
        ? "arm64"
        : null;
  if (
    !architecture ||
    release.schemaVersion !== 1 ||
    release.repository !== "n624-dev/latex-renderer" ||
    release.provenance !== "github-artifact-attestation" ||
    !/^\d+\.\d+\.\d+(?:-rc\.[1-9]\d*)?$/.test(release.version) ||
    !idPattern.test(release.commit) ||
    release.version !== binaryManifest.version ||
    release.commit !== binaryManifest.commit ||
    binaryManifest.format !== 1
  )
    throw new Error("Authority binary and signed source identities differ");
  directory(rootDirectory, uid);
  directory(join(rootDirectory, "releases"), uid);
  directory(join(rootDirectory, ".management"), uid, 0o700);
  return withLanHttpsClientLock(
    join(rootDirectory, ".management"),
    async (state) => {
      const saved = state.read("profiles.json", 32768);
      const previous = saved
        ? JSON.parse(saved.toString())
        : { format: 1, current: null, previous: null };
      if (
        previous.format !== 1 ||
        ![previous.current, previous.previous].every(
          (id) => id === null || (typeof id === "string" && idPattern.test(id)),
        )
      )
        throw new Error("Corrupt authority release selection");
      const slots = join(rootDirectory, "releases"),
        staging = join(rootDirectory, ".staging");
      const entries = readdirSync(slots);
      if (entries.length > 4 || entries.some((id) => !idPattern.test(id)))
        throw new Error("Unexpected authority release slots");
      for (const id of entries) {
        const value = marker(join(slots, id), uid);
        if (value.commit !== id || value.architecture !== architecture)
          throw new Error("Authority slot identity mismatch");
      }
      for (const id of [previous.current, previous.previous])
        if (id && !entries.includes(id))
          throw new Error("Referenced authority release is missing");
      const link = join(rootDirectory, "current");
      let linked = null;
      try {
        const stat = lstatSync(link);
        if (
          !stat.isSymbolicLink() ||
          stat.uid !== uid ||
          !/^releases\/[a-f0-9]{40}$/.test(readlinkSync(link))
        )
          throw new Error("Unsafe authority current pointer");
        linked = readlinkSync(link).slice(9);
        if (!saved || ![previous.current, previous.previous].includes(linked))
          throw new Error(
            "Authority pointer has no matching durable selection",
          );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      try {
        lstatSync(staging);
        removeTree(staging, uid);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      const target = join(slots, release.commit);
      if (!entries.includes(release.commit)) {
        directory(staging, uid);
        const files = {};
        const copy = (relative, maximum) => {
          const data = bytes(join(source, relative), uid, maximum);
          const destination = join(staging, relative);
          const parts = dirname(destination)
            .slice(staging.length + 1)
            .split("/");
          let parent = staging;
          for (const part of parts) {
            parent = join(parent, part);
            directory(parent, uid);
          }
          write(
            destination,
            data,
            relative.endsWith(".sh") || relative.includes("/bin/")
              ? 0o755
              : 0o644,
          );
          files[relative] = digest(data);
        };
        for (const base of [
          "deploy/lan-https",
          "packages/server-setup-core/src",
        ]) {
          checked(join(source, base), uid);
          for (const name of readdirSync(join(source, base))) {
            if (/^[a-z0-9-]+\.(?:mjs|d\.mts|sh)$/.test(name))
              copy(base + "/" + name, 1024 * 1024);
          }
        }
        copy("deploy/scripts/is-main-module.mjs", 65536);
        copy("deploy/lan-https/binaries.json", 65536);
        const selected = binaryManifest.binaries?.[architecture];
        if (
          selected?.path !== `bin/lan-https-linux-${architecture}` ||
          !Number.isSafeInteger(selected.bytes) ||
          selected.bytes < 1 ||
          selected.bytes > 20 * 1024 * 1024
        )
          throw new Error("Invalid authority executable selection");
        copy("deploy/lan-https/" + selected.path, 20 * 1024 * 1024);
        const image = bytes(
          join(source, "deploy/lan-https/" + selected.path),
          uid,
        );
        if (
          files["deploy/lan-https/" + selected.path] !== selected.sha256 ||
          image.length !== selected.bytes ||
          image.length < 20 ||
          image.subarray(0, 4).toString("hex") !== "7f454c46" ||
          image[4] !== 2 ||
          image[5] !== 1 ||
          image.readUInt16LE(18) !== (architecture === "amd64" ? 62 : 183)
        )
          throw new Error(
            "Authority executable checksum or architecture mismatch",
          );
        write(
          join(staging, "release.json"),
          JSON.stringify({
            format: 1,
            version: release.version,
            commit: release.commit,
            architecture,
            files,
          }) + "\n",
          0o644,
        );
        marker(staging, uid);
        const syncTree = (path) => {
          for (const name of readdirSync(path)) {
            const child = join(path, name);
            if (lstatSync(child).isDirectory()) syncTree(child);
          }
          syncDirectory(path);
        };
        syncTree(staging);
        renameSync(staging, target);
        syncDirectory(slots);
      }
      const selection = {
        format: 1,
        current: release.commit,
        previous:
          (linked ?? previous.current) === release.commit
            ? previous.previous
            : (linked ?? previous.current),
      };
      state.saveProtocolRecord("profiles.json", selection);
      const nextLink = join(rootDirectory, ".current.next");
      try {
        const stat = lstatSync(nextLink);
        if (
          !stat.isSymbolicLink() ||
          stat.uid !== uid ||
          !/^releases\/[a-f0-9]{40}$/.test(readlinkSync(nextLink))
        )
          throw new Error("Unsafe interrupted authority pointer");
        unlinkSync(nextLink);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      symlinkSync("releases/" + release.commit, nextLink);
      renameSync(nextLink, link);
      syncDirectory(rootDirectory);
      for (const id of readdirSync(slots))
        if (![selection.current, selection.previous].includes(id)) {
          marker(join(slots, id), uid);
          removeTree(join(slots, id), uid);
        }
      syncDirectory(slots);
      return Object.freeze({
        version: release.version,
        commit: release.commit,
        reused: previous.current === release.commit,
      });
    },
  );
}
if (isMainModule(import.meta.url)) {
  if (process.argv.length !== 3)
    throw new Error("Use install-authority.mjs VERIFIED_SOURCE");
  installLanHttpsAuthorityRelease(resolve(process.argv[2]))
    .then((result) => process.stdout.write(JSON.stringify(result) + "\n"))
    .catch(() => {
      process.stderr.write(
        "Authority code installation did not complete; inspect the managed code selection before retrying\n",
      );
      process.exitCode = 1;
    });
}
