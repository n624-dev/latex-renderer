import { constants } from "node:fs";
import {
  access,
  chmod,
  chown,
  copyFile,
  lstat,
  realpath,
  readdir,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";

// GNU tar's Ubuntu openat2 backport conflicts with RestrictSUIDSGID. Keep the
// service restriction and use the distro's libarchive extractor instead. No
// PATH override, configurable executable, or fallback to unrestricted tar.
export const releaseExtractor = "/usr/bin/bsdtar";

// libuv can preserve a non-root source owner when root copies a file. The
// privileged helper must claim only its NEW private copy, never the controller
// input. Its caller still rehashes the copy against the immutable release and
// verifies attestation/archive limits before extraction.
export async function copyRootReleaseBundle(source, destination) {
  if (process.getuid?.() !== 0)
    throw new Error("Root release bundle copy requires root");
  const parent = dirname(destination);
  if (
    typeof source !== "string" ||
    resolve(source) !== source ||
    (await realpath(source)) !== source ||
    resolve(destination) !== destination ||
    (await realpath(parent)) !== parent
  )
    throw new Error("Root release bundle copy requires canonical paths");
  const input = await lstat(source),
    directory = await lstat(parent);
  if (!input.isFile() || input.nlink !== 1 || input.mode & 0o022)
    throw new Error(
      "Root release bundle source must be a private regular file",
    );
  if (!directory.isDirectory() || directory.uid !== 0 || directory.mode & 0o077)
    throw new Error(
      "Root release bundle destination must be a private root directory",
    );
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await chown(destination, 0, 0);
  await chmod(destination, 0o600);
  const output = await lstat(destination);
  if (
    !output.isFile() ||
    output.uid !== 0 ||
    output.gid !== 0 ||
    output.nlink !== 1 ||
    (output.mode & 0o7777) !== 0o600
  )
    throw new Error("Root release bundle copy is not sealed");
}

export async function assertReleaseExtractor() {
  let info;
  try {
    info = await lstat(releaseExtractor);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    throw new Error(
      "Install libarchive-tools before updating: /usr/bin/bsdtar is required",
      { cause: error },
    );
  }
  if (!info.isFile() || info.uid !== 0 || info.mode & 0o022)
    throw new Error("Release extractor must be a sealed root-owned executable");
  await access(releaseExtractor, constants.X_OK);
}

// Call only after the immutable digest, attestation AND GNU tar archive limits
// have been verified. Both controller and helper use fresh private directories.
export async function prepareReleaseExtraction(bundle, directory) {
  await assertReleaseExtractor();
  for (const path of [bundle, directory]) {
    if (
      typeof path !== "string" ||
      resolve(path) !== path ||
      (await realpath(path)) !== path
    )
      throw new Error(
        "Release extraction paths must be canonical absolute paths",
      );
  }
  const file = await lstat(bundle),
    destination = await lstat(directory);
  if (
    !file.isFile() ||
    file.nlink !== 1 ||
    file.uid !== process.getuid() ||
    file.mode & 0o022
  )
    throw new Error("Release extraction requires a private regular bundle");
  if (
    !destination.isDirectory() ||
    destination.uid !== process.getuid() ||
    destination.mode & 0o077
  )
    throw new Error("Release extraction requires a private destination");
  if ((await readdir(directory)).length)
    throw new Error("Release extraction destination must be empty");
  return {
    command: releaseExtractor,
    args: [
      "-xf",
      bundle,
      "--directory",
      directory,
      "--no-same-owner",
      "--no-same-permissions",
      "--no-acls",
      "--no-fflags",
      "--no-xattrs",
      "--safe-writes",
    ],
  };
}
