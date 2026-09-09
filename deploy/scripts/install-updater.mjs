import {
  chmod,
  readFile,
  lstat,
  mkdir,
  realpath,
  readlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { UpdaterSlots, updaterEnvelope } from "./updater-slots.mjs";

if (process.getuid() !== 0 || process.argv.length !== 2)
  throw new Error(
    "Run the verified release's install-updater.mjs as root, without arguments",
  );
const source = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const slots = new UpdaterSlots("/opt/latex-renderer/updater", 0);
await slots.initialize();
const envelope = JSON.parse(
  await readFile(join(source, ".latex-renderer-updater.json"), "utf8"),
);
const id = await slots.stage(source, envelope);

// Capture the known, installed old controller before changing any service path.
// It stays runnable even after application release pruning or a failed cutover.
try {
  await slots.state();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  try {
    const target = await readlink("/opt/latex-renderer/current");
    const old = resolve("/opt/latex-renderer", target);
    if (
      !/^\/opt\/latex-renderer\/releases\/[A-Za-z0-9._-]+$/.test(old) ||
      (await realpath(old)) !== old
    )
      throw new Error("Invalid legacy application release path", {
        cause: error,
      });
    const manifest = JSON.parse(
      await readFile(join(old, ".latex-renderer-release.json"), "utf8"),
    );
    await slots.nominate(
      await slots.stage(old, await updaterEnvelope(old, manifest, true)),
    );
  } catch (legacyError) {
    if (legacyError.code !== "ENOENT") throw legacyError;
    // First install (not a migration). No prior controller exists to recover.
    try {
      await lstat("/opt/latex-renderer/current");
      throw new Error(
        "Existing application lacks verified migration metadata",
        { cause: legacyError },
      );
    } catch (missing) {
      if (missing.code !== "ENOENT") throw missing;
    }
    await slots.nominate(id);
  }
}

// A frozen bootstrap implementation is installed once, never loaded from the
// mutable application pointer. Changing this implementation requires an explicit
// bootstrap protocol migration, not an accidental application overlay.
const bootstrap = join(slots.root, "bootstrap-v1");
await mkdir(bootstrap, { mode: 0o755 }).catch((e) => {
  if (e.code !== "EEXIST") throw e;
});
if ((await realpath(bootstrap)) !== bootstrap)
  throw new Error("Unsafe bootstrap directory");
const info = await lstat(bootstrap);
if (!info.isDirectory() || info.uid !== 0 || info.mode & 0o022)
  throw new Error("Unsafe bootstrap directory");
await chmod(bootstrap, 0o755);
for (const name of [
  "updater-bootstrap.mjs",
  "updater-entry.mjs",
  "updater-slots.mjs",
  "published-release.mjs",
  "release-attestation.mjs",
  "release-version.mjs",
  "release-archive.mjs",
  "mutation-lock.mjs",
]) {
  const input = join(source, "deploy/scripts", name),
    output = join(bootstrap, name);
  const inputInfo = await lstat(input);
  if (!inputInfo.isFile() || inputInfo.uid !== 0 || inputInfo.mode & 0o022)
    throw new Error("Unsealed bootstrap source");
  const data = await readFile(input);
  try {
    const outputInfo = await lstat(output);
    if (
      !outputInfo.isFile() ||
      outputInfo.uid !== 0 ||
      outputInfo.mode & 0o022 ||
      !data.equals(await readFile(output))
    )
      throw new Error(
        "Installed bootstrap v1 differs; explicit bootstrap migration required",
      );
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await slots.atomic(output, data);
  }
}
// Syntax check all entry points before service configuration is changed.
for (const script of ["updater-entry.mjs", "updater-bootstrap.mjs"])
  execFileSync("/usr/local/bin/node", ["--check", join(bootstrap, script)]);
await slots.nominate(id);
await slots.collect();
console.log(`Prepared independent Updater ${envelope.version}`);
